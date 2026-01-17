//! ============================================================================
//! Twitter OAuth 2.0 + PKCE Authentication
//! ============================================================================
//! Implements the OAuth 2.0 authorization code flow with PKCE for Twitter.
//! No client secret needed (public client for native apps).
//! ============================================================================

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tiny_http::{Response, Server};
use tracing::{debug, error, info};

const TWITTER_AUTH_URL: &str = "https://twitter.com/i/oauth2/authorize";
const TWITTER_TOKEN_URL: &str = "https://api.twitter.com/2/oauth2/token";
const CALLBACK_PORT: u16 = 9876;
const CALLBACK_URL: &str = "http://localhost:9876/callback";

/// Scopes needed for Tetsuo Twitter features
const SCOPES: &str = "tweet.read tweet.write users.read offline.access";

/// OAuth 2.0 tokens for Twitter API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TwitterTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
    pub scope: String,
}

impl TwitterTokens {
    /// Check if tokens are expired (with 5 min buffer)
    pub fn is_expired(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        self.expires_at <= now + 300 // 5 minute buffer
    }
}

/// Twitter OAuth 2.0 client
pub struct TwitterOAuth {
    client_id: String,
    client: Client,
}

impl TwitterOAuth {
    /// Create a new Twitter OAuth client
    pub fn new(client_id: String) -> Self {
        Self {
            client_id,
            client: Client::new(),
        }
    }

    /// Generate PKCE code verifier and challenge
    fn generate_pkce() -> (String, String) {
        // Generate random 64-byte verifier using allowed characters
        const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
        let verifier: String = (0..64)
            .map(|_| {
                let idx = rand::random::<usize>() % CHARSET.len();
                CHARSET[idx] as char
            })
            .collect();

        // SHA256 hash and base64url encode for challenge
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

        (verifier, challenge)
    }

    /// Generate a random state parameter for CSRF protection
    fn generate_state() -> String {
        (0..32)
            .map(|_| format!("{:02x}", rand::random::<u8>()))
            .collect()
    }

    /// Get the authorization URL to open in browser
    /// Returns: (url, code_verifier, state)
    pub fn get_auth_url(&self) -> (String, String, String) {
        let (verifier, challenge) = Self::generate_pkce();
        let state = Self::generate_state();

        let url = format!(
            "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
            TWITTER_AUTH_URL,
            urlencoding::encode(&self.client_id),
            urlencoding::encode(CALLBACK_URL),
            urlencoding::encode(SCOPES),
            &state,
            &challenge
        );

        debug!("Generated auth URL with state: {}", state);
        (url, verifier, state)
    }

    /// Start local server and wait for OAuth callback
    /// This blocks until the callback is received or timeout
    pub fn wait_for_callback(expected_state: &str) -> Result<String> {
        let addr = format!("127.0.0.1:{}", CALLBACK_PORT);
        let server = Server::http(&addr)
            .map_err(|e| anyhow!("Failed to start callback server on {}: {}", addr, e))?;

        info!(
            "Waiting for Twitter OAuth callback on port {}",
            CALLBACK_PORT
        );

        // Wait for the callback request with timeout
        let request = server
            .recv_timeout(Duration::from_secs(300))
            .map_err(|e| anyhow!("Callback server error: {}", e))?
            .ok_or_else(|| anyhow!("Callback server timed out waiting for response"))?;

        let url = request.url().to_string();
        debug!("Received callback: {}", url);

        // Send success response to browser
        let html = r#"
<!DOCTYPE html>
<html>
<head>
    <title>Tetsuo - Twitter Connected</title>
    <style>
        body {
            font-family: 'SF Mono', 'Monaco', monospace;
            background: #0a0a0a;
            color: #00ff00;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            border: 1px solid #00ff00;
            padding: 40px;
            animation: glow 2s infinite;
        }
        @keyframes glow {
            0%, 100% { box-shadow: 0 0 10px #00ff00; }
            50% { box-shadow: 0 0 20px #00ff00, 0 0 30px #00ff00; }
        }
        h1 { margin: 0 0 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>&#x2713; CONNECTION ESTABLISHED</h1>
        <p>Twitter linked to Tetsuo. You can close this window.</p>
    </div>
</body>
</html>
"#;

        let response = Response::from_string(html).with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                .unwrap(),
        );
        let _ = request.respond(response);

        // Parse the callback URL
        let full_url = format!("http://localhost{}", url);
        let parsed =
            url::Url::parse(&full_url).map_err(|e| anyhow!("Failed to parse callback URL: {}", e))?;

        let params: std::collections::HashMap<_, _> = parsed.query_pairs().collect();

        // Verify state to prevent CSRF
        let state = params
            .get("state")
            .ok_or_else(|| anyhow!("No state parameter in callback"))?;

        if state != expected_state {
            error!("State mismatch: expected {}, got {}", expected_state, state);
            return Err(anyhow!("State mismatch - possible CSRF attack"));
        }

        // Check for error response
        if let Some(error) = params.get("error") {
            let desc = params
                .get("error_description")
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown error".to_string());
            return Err(anyhow!("Twitter OAuth error: {} - {}", error, desc));
        }

        // Get authorization code
        let code = params
            .get("code")
            .ok_or_else(|| anyhow!("No authorization code in callback"))?;

        info!("Successfully received authorization code");
        Ok(code.to_string())
    }

    /// Exchange authorization code for access tokens
    pub async fn exchange_code(&self, code: &str, verifier: &str) -> Result<TwitterTokens> {
        info!("Exchanging authorization code for tokens");

        let params = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", CALLBACK_URL),
            ("client_id", &self.client_id),
            ("code_verifier", verifier),
        ];

        let response = self
            .client
            .post(TWITTER_TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&params)
            .send()
            .await
            .map_err(|e| anyhow!("Token request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!("Token exchange failed: {} - {}", status, error_text);
            return Err(anyhow!("Token exchange failed ({}): {}", status, error_text));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: Option<String>,
            expires_in: i64,
            scope: String,
        }

        let token_response: TokenResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse token response: {}", e))?;

        let expires_at = chrono::Utc::now().timestamp() + token_response.expires_in;

        info!(
            "Successfully obtained tokens, expires in {} seconds",
            token_response.expires_in
        );

        Ok(TwitterTokens {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_at,
            scope: token_response.scope,
        })
    }

    /// Refresh expired tokens using refresh_token
    pub async fn refresh_tokens(&self, refresh_token: &str) -> Result<TwitterTokens> {
        info!("Refreshing expired tokens");

        let params = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &self.client_id),
        ];

        let response = self
            .client
            .post(TWITTER_TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&params)
            .send()
            .await
            .map_err(|e| anyhow!("Token refresh request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!("Token refresh failed: {} - {}", status, error_text);
            return Err(anyhow!(
                "Token refresh failed ({}): {}",
                status,
                error_text
            ));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: Option<String>,
            expires_in: i64,
            scope: String,
        }

        let token_response: TokenResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse refresh response: {}", e))?;

        let expires_at = chrono::Utc::now().timestamp() + token_response.expires_in;

        info!("Successfully refreshed tokens");

        Ok(TwitterTokens {
            access_token: token_response.access_token,
            refresh_token: token_response.refresh_token,
            expires_at,
            scope: token_response.scope,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pkce_generation() {
        let (verifier, challenge) = TwitterOAuth::generate_pkce();
        assert_eq!(verifier.len(), 64);
        assert!(!challenge.is_empty());
        // Verify all characters are valid
        assert!(verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c)));
    }

    #[test]
    fn test_state_generation() {
        let state = TwitterOAuth::generate_state();
        assert_eq!(state.len(), 64); // 32 bytes * 2 hex chars
        assert!(state.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_auth_url_generation() {
        let oauth = TwitterOAuth::new("test_client_id".to_string());
        let (url, verifier, state) = oauth.get_auth_url();

        assert!(url.contains("twitter.com"));
        assert!(url.contains("client_id=test_client_id"));
        assert!(url.contains("code_challenge="));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(!verifier.is_empty());
        assert!(!state.is_empty());
    }

    #[test]
    fn test_token_expiry() {
        let mut tokens = TwitterTokens {
            access_token: "test".to_string(),
            refresh_token: Some("refresh".to_string()),
            expires_at: chrono::Utc::now().timestamp() + 3600,
            scope: "tweet.read".to_string(),
        };

        assert!(!tokens.is_expired());

        tokens.expires_at = chrono::Utc::now().timestamp() - 100;
        assert!(tokens.is_expired());
    }
}
