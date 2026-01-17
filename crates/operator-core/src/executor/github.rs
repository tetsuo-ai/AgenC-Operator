//! ============================================================================
//! GitHub Executor - GitHub API Integration
//! ============================================================================
//! Handles GitHub operations using Personal Access Token authentication:
//! - Create issues
//! - Add comments to issues/PRs
//! - Trigger workflow dispatch events
//! - Create/update gists
//! ============================================================================

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

/// GitHub API base URL
const GITHUB_API: &str = "https://api.github.com";

/// Result from a GitHub issue operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueResult {
    pub issue_number: u64,
    pub url: String,
}

/// Result from a GitHub comment operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentResult {
    pub comment_id: u64,
    pub url: String,
}

/// Result from a GitHub gist operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GistResult {
    pub gist_id: String,
    pub url: String,
    pub raw_url: Option<String>,
}

/// Result from a workflow dispatch
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowResult {
    pub triggered: bool,
}

/// Executor for GitHub operations
pub struct GitHubExecutor {
    client: reqwest::Client,
    token: String,
    default_owner: Option<String>,
    default_repo: Option<String>,
}

impl GitHubExecutor {
    /// Create a new GitHubExecutor with Personal Access Token
    pub fn new(token: String, default_owner: Option<String>, default_repo: Option<String>) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("tetsuo-operator/1.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            token,
            default_owner,
            default_repo,
        }
    }

    /// Create an issue in a repository
    pub async fn create_issue(
        &self,
        owner: &str,
        repo: &str,
        title: &str,
        body: &str,
        labels: Option<Vec<String>>,
    ) -> Result<IssueResult> {
        info!("Creating issue in {}/{}: {}", owner, repo, title);

        let url = format!("{}/repos/{}/{}/issues", GITHUB_API, owner, repo);

        let request = CreateIssueRequest {
            title: title.to_string(),
            body: Some(body.to_string()),
            labels,
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to create issue: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("GitHub API error {}: {}", status, body));
        }

        let issue: IssueResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse issue response: {}", e))?;

        info!("Created issue #{}", issue.number);

        Ok(IssueResult {
            issue_number: issue.number,
            url: issue.html_url,
        })
    }

    /// Add a comment to an issue or PR
    pub async fn add_comment(
        &self,
        owner: &str,
        repo: &str,
        issue_number: u64,
        body: &str,
    ) -> Result<CommentResult> {
        info!(
            "Adding comment to {}/{} #{}",
            owner, repo, issue_number
        );

        let url = format!(
            "{}/repos/{}/{}/issues/{}/comments",
            GITHUB_API, owner, repo, issue_number
        );

        let request = CreateCommentRequest {
            body: body.to_string(),
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to add comment: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("GitHub API error {}: {}", status, body));
        }

        let comment: CommentResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse comment response: {}", e))?;

        info!("Added comment {}", comment.id);

        Ok(CommentResult {
            comment_id: comment.id,
            url: comment.html_url,
        })
    }

    /// Trigger a workflow dispatch event
    pub async fn trigger_workflow(
        &self,
        owner: &str,
        repo: &str,
        workflow_id: &str,
        ref_name: &str,
        inputs: Option<serde_json::Value>,
    ) -> Result<WorkflowResult> {
        info!(
            "Triggering workflow {} in {}/{}",
            workflow_id, owner, repo
        );

        let url = format!(
            "{}/repos/{}/{}/actions/workflows/{}/dispatches",
            GITHUB_API, owner, repo, workflow_id
        );

        let request = WorkflowDispatchRequest {
            r#ref: ref_name.to_string(),
            inputs,
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to trigger workflow: {}", e))?;

        // Workflow dispatch returns 204 No Content on success
        if response.status().as_u16() == 204 {
            info!("Triggered workflow {}", workflow_id);
            return Ok(WorkflowResult { triggered: true });
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("GitHub API error {}: {}", status, body));
        }

        Ok(WorkflowResult { triggered: true })
    }

    /// Create a gist (can be public or secret)
    pub async fn create_gist(
        &self,
        description: &str,
        filename: &str,
        content: &str,
        public: bool,
    ) -> Result<GistResult> {
        info!("Creating gist: {}", description);

        let url = format!("{}/gists", GITHUB_API);

        let mut files = std::collections::HashMap::new();
        files.insert(
            filename.to_string(),
            GistFile {
                content: content.to_string(),
            },
        );

        let request = CreateGistRequest {
            description: description.to_string(),
            public,
            files,
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to create gist: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("GitHub API error {}: {}", status, body));
        }

        let gist: GistResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse gist response: {}", e))?;

        info!("Created gist {}", gist.id);

        // Get raw URL for the first file
        let raw_url = gist
            .files
            .values()
            .next()
            .and_then(|f| f.raw_url.clone());

        Ok(GistResult {
            gist_id: gist.id,
            url: gist.html_url,
            raw_url,
        })
    }

    /// Get owner/repo, using overrides or defaults
    pub fn get_repo_info(
        &self,
        override_owner: Option<&str>,
        override_repo: Option<&str>,
    ) -> Result<(String, String)> {
        let owner = override_owner
            .map(|s| s.to_string())
            .or_else(|| self.default_owner.clone())
            .ok_or_else(|| anyhow!("No owner provided and no default configured"))?;

        let repo = override_repo
            .map(|s| s.to_string())
            .or_else(|| self.default_repo.clone())
            .ok_or_else(|| anyhow!("No repo provided and no default configured"))?;

        Ok((owner, repo))
    }
}

// ============================================================================
// GitHub API Types
// ============================================================================

#[derive(Debug, Serialize)]
struct CreateIssueRequest {
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    labels: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct IssueResponse {
    number: u64,
    html_url: String,
}

#[derive(Debug, Serialize)]
struct CreateCommentRequest {
    body: String,
}

#[derive(Debug, Deserialize)]
struct CommentResponse {
    id: u64,
    html_url: String,
}

#[derive(Debug, Serialize)]
struct WorkflowDispatchRequest {
    r#ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    inputs: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct CreateGistRequest {
    description: String,
    public: bool,
    files: std::collections::HashMap<String, GistFile>,
}

#[derive(Debug, Serialize)]
struct GistFile {
    content: String,
}

#[derive(Debug, Deserialize)]
struct GistResponse {
    id: String,
    html_url: String,
    files: std::collections::HashMap<String, GistFileResponse>,
}

#[derive(Debug, Deserialize)]
struct GistFileResponse {
    raw_url: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_github_executor_creation() {
        let executor = GitHubExecutor::new(
            "ghp_test_token".to_string(),
            Some("testowner".to_string()),
            Some("testrepo".to_string()),
        );

        let (owner, repo) = executor.get_repo_info(None, None).unwrap();
        assert_eq!(owner, "testowner");
        assert_eq!(repo, "testrepo");
    }

    #[test]
    fn test_get_repo_info_with_overrides() {
        let executor = GitHubExecutor::new(
            "ghp_test_token".to_string(),
            Some("default".to_string()),
            Some("default-repo".to_string()),
        );

        let (owner, repo) = executor
            .get_repo_info(Some("override"), Some("override-repo"))
            .unwrap();
        assert_eq!(owner, "override");
        assert_eq!(repo, "override-repo");
    }

    #[test]
    fn test_get_repo_info_no_default() {
        let executor = GitHubExecutor::new("ghp_test_token".to_string(), None, None);
        assert!(executor.get_repo_info(None, None).is_err());
        assert!(executor.get_repo_info(Some("owner"), None).is_err());
        assert!(executor.get_repo_info(Some("owner"), Some("repo")).is_ok());
    }

    #[test]
    fn test_issue_request_serialization() {
        let request = CreateIssueRequest {
            title: "Test Issue".to_string(),
            body: Some("Test body".to_string()),
            labels: Some(vec!["bug".to_string(), "help wanted".to_string()]),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("Test Issue"));
        assert!(json.contains("bug"));
    }

    #[test]
    fn test_workflow_dispatch_serialization() {
        let request = WorkflowDispatchRequest {
            r#ref: "main".to_string(),
            inputs: Some(serde_json::json!({
                "environment": "production"
            })),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("main"));
        assert!(json.contains("production"));
    }
}
