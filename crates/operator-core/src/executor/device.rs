//! ============================================================================
//! Device Executor - AgenC One Device Discovery & Pairing
//! ============================================================================
//! Handles discovering and pairing with AgenC One hardware nodes:
//! - mDNS discovery (primary, pure Rust via mdns-sd)
//! - Challenge-response pairing over HTTP
//! - Device health checking and config push
//! ============================================================================

use anyhow::{anyhow, Result};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::types::{
    DeviceAgentConfig, DeviceCommandResult, DeviceStatus, DiscoveredDevice, DiscoveryMethod,
    PairResult, PairedDevice,
};

/// mDNS service type for AgenC One nodes
const AGENC_ONE_SERVICE_TYPE: &str = "_agencone._tcp.local.";

/// Default API port on AgenC One devices
const DEFAULT_DEVICE_PORT: u16 = 8420;

/// Device discovery and management executor
pub struct DeviceExecutor {
    client: reqwest::Client,
    discovered: Arc<RwLock<Vec<DiscoveredDevice>>>,
    scanning: Arc<RwLock<bool>>,
}

impl DeviceExecutor {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            discovered: Arc::new(RwLock::new(Vec::new())),
            scanning: Arc::new(RwLock::new(false)),
        }
    }

    // ========================================================================
    // mDNS Discovery
    // ========================================================================

    /// Scan for AgenC One devices via mDNS. Collects results for `duration_secs`.
    pub async fn scan_mdns(&self, duration_secs: u64) -> Result<Vec<DiscoveredDevice>> {
        if *self.scanning.read().await {
            return Err(anyhow!("Scan already in progress"));
        }

        *self.scanning.write().await = true;
        info!("Starting mDNS scan for {} seconds...", duration_secs);

        let discovered = Arc::clone(&self.discovered);
        let scanning = Arc::clone(&self.scanning);

        // Run mDNS browse in a blocking task since mdns-sd uses sync channels
        let result = tokio::task::spawn_blocking(move || {
            let mdns = mdns_sd::ServiceDaemon::new()
                .map_err(|e| anyhow!("Failed to create mDNS daemon: {}", e))?;

            let receiver = mdns
                .browse(AGENC_ONE_SERVICE_TYPE)
                .map_err(|e| anyhow!("Failed to browse mDNS: {}", e))?;

            let mut devices = Vec::new();
            let deadline =
                std::time::Instant::now() + std::time::Duration::from_secs(duration_secs);

            while std::time::Instant::now() < deadline {
                match receiver.recv_timeout(std::time::Duration::from_millis(500)) {
                    Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                        let ip = info
                            .get_addresses()
                            .iter()
                            .find(|a| a.is_ipv4())
                            .or_else(|| info.get_addresses().iter().next())
                            .map(|a| a.to_string());

                        let device_id = info
                            .get_property_val_str("device_id")
                            .unwrap_or_else(|| info.get_fullname())
                            .to_string();

                        let version = info
                            .get_property_val_str("version")
                            .map(|s| s.to_string());

                        let device = DiscoveredDevice {
                            device_id,
                            name: info.get_fullname().to_string(),
                            ip_address: ip,
                            port: Some(info.get_port()),
                            discovery_method: DiscoveryMethod::Mdns,
                            rssi: None,
                            version,
                            discovered_at: chrono::Utc::now().timestamp(),
                        };

                        info!("Discovered device: {} at {:?}:{}", device.name, device.ip_address, device.port.unwrap_or(0));
                        devices.push(device);
                    }
                    Ok(_) => {} // Other events (searching, removed, etc.)
                    Err(_) => continue, // timeout or disconnected
                }
            }

            // Shutdown daemon
            let _ = mdns.shutdown();

            Ok::<Vec<DiscoveredDevice>, anyhow::Error>(devices)
        })
        .await
        .map_err(|e| anyhow!("mDNS task panicked: {}", e))??;

        *discovered.write().await = result.clone();
        *scanning.write().await = false;
        info!("mDNS scan complete: found {} devices", result.len());
        Ok(result)
    }

    /// Get devices from the most recent scan
    pub async fn get_discovered(&self) -> Vec<DiscoveredDevice> {
        self.discovered.read().await.clone()
    }

    /// Check if a scan is in progress
    pub async fn is_scanning(&self) -> bool {
        *self.scanning.read().await
    }

    // ========================================================================
    // Pairing Protocol (Challenge-Response over HTTP)
    // ========================================================================

    /// Pair with a discovered device using challenge-response.
    pub async fn pair_device(
        &self,
        device: &DiscoveredDevice,
        wallet_pubkey: &str,
    ) -> Result<PairResult> {
        let base_url = format!(
            "http://{}:{}",
            device
                .ip_address
                .as_deref()
                .ok_or_else(|| anyhow!("No IP address for device"))?,
            device.port.unwrap_or(DEFAULT_DEVICE_PORT)
        );

        // Step 1: Request challenge
        info!("Requesting pairing challenge from {}", base_url);
        let challenge_resp = self
            .client
            .post(format!("{}/api/pair/challenge", base_url))
            .json(&serde_json::json!({ "wallet_pubkey": wallet_pubkey }))
            .send()
            .await
            .map_err(|e| anyhow!("Challenge request failed: {}", e))?;

        if !challenge_resp.status().is_success() {
            return Ok(PairResult {
                success: false,
                device: None,
                error: Some(format!("Challenge failed: HTTP {}", challenge_resp.status())),
            });
        }

        let challenge: ChallengeResponse = challenge_resp
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse challenge: {}", e))?;

        // Step 2: Create HMAC signature
        let signature = self.sign_challenge(&challenge.challenge, wallet_pubkey)?;

        // Step 3: Verify
        info!("Sending pairing verification...");
        let verify_resp = self
            .client
            .post(format!("{}/api/pair/verify", base_url))
            .json(&serde_json::json!({
                "wallet_pubkey": wallet_pubkey,
                "signature": signature,
            }))
            .send()
            .await
            .map_err(|e| anyhow!("Verify request failed: {}", e))?;

        if !verify_resp.status().is_success() {
            return Ok(PairResult {
                success: false,
                device: None,
                error: Some(format!("Verify failed: HTTP {}", verify_resp.status())),
            });
        }

        let verify: VerifyResponse = verify_resp
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse verify: {}", e))?;

        if verify.paired {
            let paired = PairedDevice {
                device_id: verify
                    .device_id
                    .unwrap_or_else(|| device.device_id.clone()),
                name: device.name.clone(),
                ip_address: device.ip_address.clone().unwrap_or_default(),
                port: device.port.unwrap_or(DEFAULT_DEVICE_PORT),
                shared_secret: verify.shared_secret.unwrap_or_default(),
                paired_by_wallet: wallet_pubkey.to_string(),
                paired_at: chrono::Utc::now().timestamp(),
                last_seen: chrono::Utc::now().timestamp(),
                status: DeviceStatus::Online,
                agent_config: None,
            };
            info!("Successfully paired with device: {}", paired.device_id);
            Ok(PairResult {
                success: true,
                device: Some(paired),
                error: None,
            })
        } else {
            Ok(PairResult {
                success: false,
                device: None,
                error: Some("Device rejected pairing".to_string()),
            })
        }
    }

    fn sign_challenge(&self, challenge: &str, wallet_pubkey: &str) -> Result<String> {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;

        let mut mac = HmacSha256::new_from_slice(wallet_pubkey.as_bytes())
            .map_err(|e| anyhow!("HMAC init failed: {}", e))?;
        mac.update(challenge.as_bytes());
        let result = mac.finalize();
        Ok(hex::encode(result.into_bytes()))
    }

    // ========================================================================
    // Device Communication
    // ========================================================================

    /// Check if a paired device is reachable
    pub async fn check_health(&self, device: &PairedDevice) -> Result<DeviceCommandResult> {
        let url = format!("http://{}:{}/api/health", device.ip_address, device.port);
        debug!("Checking health: {}", url);

        match self.client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => Ok(DeviceCommandResult {
                success: true,
                message: "Device online".to_string(),
                data: resp.json().await.ok(),
            }),
            Ok(resp) => Ok(DeviceCommandResult {
                success: false,
                message: format!("HTTP {}", resp.status()),
                data: None,
            }),
            Err(e) => Ok(DeviceCommandResult {
                success: false,
                message: format!("Unreachable: {}", e),
                data: None,
            }),
        }
    }

    /// Push agent configuration to a paired device
    pub async fn configure_device(
        &self,
        device: &PairedDevice,
        config: &DeviceAgentConfig,
    ) -> Result<DeviceCommandResult> {
        let url = format!(
            "http://{}:{}/api/agent/configure",
            device.ip_address, device.port
        );
        info!("Pushing config to device {}: {}", device.device_id, url);

        let resp = self
            .client
            .post(&url)
            .header("X-Shared-Secret", &device.shared_secret)
            .json(config)
            .send()
            .await
            .map_err(|e| anyhow!("Config push failed: {}", e))?;

        if resp.status().is_success() {
            Ok(DeviceCommandResult {
                success: true,
                message: "Configuration applied".to_string(),
                data: resp.json().await.ok(),
            })
        } else {
            Ok(DeviceCommandResult {
                success: false,
                message: format!("Config rejected: HTTP {}", resp.status()),
                data: None,
            })
        }
    }

    /// Send an arbitrary command to a paired device
    pub async fn send_command(
        &self,
        device: &PairedDevice,
        command: &str,
        payload: Option<serde_json::Value>,
    ) -> Result<DeviceCommandResult> {
        let url = format!(
            "http://{}:{}/api/command",
            device.ip_address, device.port
        );
        debug!("Sending command '{}' to device {}", command, device.device_id);

        let body = serde_json::json!({
            "command": command,
            "payload": payload,
        });

        let resp = self
            .client
            .post(&url)
            .header("X-Shared-Secret", &device.shared_secret)
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow!("Command failed: {}", e))?;

        Ok(DeviceCommandResult {
            success: resp.status().is_success(),
            message: if resp.status().is_success() {
                "OK".to_string()
            } else {
                format!("HTTP {}", resp.status())
            },
            data: resp.json().await.ok(),
        })
    }
}

// Internal protocol types
#[derive(Deserialize)]
struct ChallengeResponse {
    challenge: String,
}

#[derive(Deserialize)]
struct VerifyResponse {
    paired: bool,
    shared_secret: Option<String>,
    device_id: Option<String>,
}
