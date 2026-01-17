//! ============================================================================
//! Grok Code Executor - Code Operations via x.ai API
//! ============================================================================
//! Uses grok-code-fast-1 model for code-related operations:
//! - Fix: Identify and fix bugs/issues in code
//! - Review: Provide code review feedback
//! - Generate: Create new code from description
//! - Explain: Explain what code does
//! ============================================================================

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

/// API endpoint for x.ai chat completions
const XAI_API_URL: &str = "https://api.x.ai/v1/chat/completions";

/// Model for code operations
const CODE_MODEL: &str = "grok-code-fast-1";

/// Executor for code operations using Grok
pub struct GrokCodeExecutor {
    client: reqwest::Client,
    api_key: String,
}

impl GrokCodeExecutor {
    /// Create a new GrokCodeExecutor
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
        }
    }

    /// Fix code based on issue description
    pub async fn fix_code(&self, code: &str, issue: &str, language: &str) -> Result<String> {
        info!("Fixing code issue: {}", issue);

        let prompt = format!(
            "You are a code fixing assistant. Fix the following {} code based on the issue described.\n\n\
            Issue: {}\n\n\
            Code:\n```{}\n{}\n```\n\n\
            Respond with ONLY the fixed code, no explanations. Wrap in ```{} code block.",
            language, issue, language, code, language
        );

        let response = self.call_api(&prompt).await?;
        Ok(extract_code_block(&response, language))
    }

    /// Review code and provide feedback
    pub async fn review_code(&self, code: &str, language: &str) -> Result<String> {
        info!("Reviewing {} code", language);

        let prompt = format!(
            "You are a code review assistant. Review the following {} code and provide constructive feedback.\n\n\
            Focus on:\n\
            - Bugs or potential issues\n\
            - Performance concerns\n\
            - Security vulnerabilities\n\
            - Code style and best practices\n\
            - Suggestions for improvement\n\n\
            Code:\n```{}\n{}\n```\n\n\
            Provide your review in a clear, structured format.",
            language, language, code
        );

        self.call_api(&prompt).await
    }

    /// Generate code from description
    pub async fn generate_code(&self, description: &str, language: &str) -> Result<String> {
        info!("Generating {} code: {}", language, description);

        let prompt = format!(
            "You are a code generation assistant. Generate {} code based on the following description.\n\n\
            Description: {}\n\n\
            Requirements:\n\
            - Write clean, idiomatic {} code\n\
            - Include appropriate error handling\n\
            - Add brief comments for complex logic\n\n\
            Respond with ONLY the code, wrapped in ```{} code block.",
            language, description, language, language
        );

        let response = self.call_api(&prompt).await?;
        Ok(extract_code_block(&response, language))
    }

    /// Explain what code does
    pub async fn explain_code(&self, code: &str, language: &str) -> Result<String> {
        info!("Explaining {} code", language);

        let prompt = format!(
            "You are a code explanation assistant. Explain the following {} code in clear, simple terms.\n\n\
            Code:\n```{}\n{}\n```\n\n\
            Provide:\n\
            1. A high-level summary of what the code does\n\
            2. A breakdown of key sections/functions\n\
            3. Any notable patterns or techniques used\n\
            4. Potential use cases",
            language, language, code
        );

        self.call_api(&prompt).await
    }

    /// Call the x.ai API
    async fn call_api(&self, prompt: &str) -> Result<String> {
        debug!("Calling x.ai API with {} chars", prompt.len());

        let request = ChatRequest {
            model: CODE_MODEL.to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
            temperature: Some(0.3), // Lower temperature for code
            max_tokens: Some(4096),
        };

        let response = self
            .client
            .post(XAI_API_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to call x.ai API: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("x.ai API error {}: {}", status, body));
        }

        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse API response: {}", e))?;

        chat_response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| anyhow!("No response from API"))
    }
}

/// Extract code block from markdown response
fn extract_code_block(response: &str, _language: &str) -> String {
    // Try to find code block
    if let Some(start) = response.find("```") {
        let after_start = &response[start + 3..];
        // Skip language identifier if present
        let code_start = after_start.find('\n').map(|i| i + 1).unwrap_or(0);
        let code_content = &after_start[code_start..];

        if let Some(end) = code_content.find("```") {
            return code_content[..end].trim().to_string();
        }
    }

    // Return as-is if no code block found
    response.trim().to_string()
}

// ============================================================================
// API Types
// ============================================================================

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_code_block() {
        let response = "Here's the code:\n```rust\nfn main() {\n    println!(\"Hello\");\n}\n```";
        let extracted = extract_code_block(response, "rust");
        assert_eq!(extracted, "fn main() {\n    println!(\"Hello\");\n}");
    }

    #[test]
    fn test_extract_code_block_no_block() {
        let response = "fn main() { println!(\"Hello\"); }";
        let extracted = extract_code_block(response, "rust");
        assert_eq!(extracted, "fn main() { println!(\"Hello\"); }");
    }
}
