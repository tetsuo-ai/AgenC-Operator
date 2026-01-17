//! ============================================================================
//! Email Executor - Email Sending via Resend API
//! ============================================================================
//! Handles sending emails using the Resend API:
//! - Send single emails (plain text or HTML)
//! - Send bulk emails to multiple recipients
//! ============================================================================

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use crate::types::{BulkEmailResult, EmailResult};

/// Resend API endpoint
const RESEND_API: &str = "https://api.resend.com/emails";

/// Executor for email operations via Resend
pub struct EmailExecutor {
    client: reqwest::Client,
    api_key: String,
    from_email: String,
    from_name: String,
}

impl EmailExecutor {
    /// Create a new EmailExecutor with Resend API key
    pub fn new(api_key: String, from_email: String, from_name: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
            from_email,
            from_name,
        }
    }

    /// Send a single email
    pub async fn send(
        &self,
        to: &str,
        subject: &str,
        body: &str,
        html: bool,
    ) -> Result<EmailResult> {
        info!("Sending email to {}: {}", to, subject);

        let from = format!("{} <{}>", self.from_name, self.from_email);

        let request = if html {
            EmailRequest {
                from,
                to: vec![to.to_string()],
                subject: subject.to_string(),
                text: None,
                html: Some(body.to_string()),
            }
        } else {
            EmailRequest {
                from,
                to: vec![to.to_string()],
                subject: subject.to_string(),
                text: Some(body.to_string()),
                html: None,
            }
        };

        let response = self
            .client
            .post(RESEND_API)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to send email: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Resend API error {}: {}", status, body));
        }

        let email_response: ResendResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse Resend response: {}", e))?;

        info!("Email sent: {}", email_response.id);

        Ok(EmailResult {
            id: email_response.id,
        })
    }

    /// Send bulk emails to multiple recipients
    pub async fn send_bulk(
        &self,
        recipients: Vec<String>,
        subject: &str,
        body: &str,
    ) -> Result<BulkEmailResult> {
        info!("Sending bulk email to {} recipients", recipients.len());

        let mut success: u32 = 0;
        let mut failed: u32 = 0;

        for recipient in recipients {
            debug!("Sending to {}", recipient);

            match self.send(&recipient, subject, body, false).await {
                Ok(_) => success += 1,
                Err(e) => {
                    warn!("Failed to send to {}: {}", recipient, e);
                    failed += 1;
                }
            }

            // Rate limit: 100ms between emails
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        info!("Bulk email complete: {} success, {} failed", success, failed);

        Ok(BulkEmailResult { success, failed })
    }
}

// ============================================================================
// Resend API Types
// ============================================================================

#[derive(Debug, Serialize)]
struct EmailRequest {
    from: String,
    to: Vec<String>,
    subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    html: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResendResponse {
    id: String,
}
