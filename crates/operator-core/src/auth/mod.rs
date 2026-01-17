//! ============================================================================
//! Auth Module - OAuth and Authentication Flows
//! ============================================================================
//! Handles authentication for external services:
//! - Twitter OAuth 2.0 + PKCE
//! ============================================================================

mod twitter_oauth;

pub use twitter_oauth::{TwitterOAuth, TwitterTokens};
