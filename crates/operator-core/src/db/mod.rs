// ============================================================================
// OperatorDb — Embedded Database (redb)
// ============================================================================
// Persistent local storage for tasks, sessions, proofs, and config.
// Default path: ~/.agenc/operator.redb (override via AGENC_DB_PATH env var)
// ============================================================================

pub mod types;

pub use types::{
    DbStats, DbTaskStatus, OperatorConfig, SessionState, TaskRecord, TranscriptEntry,
    VerificationLog,
};

use anyhow::{anyhow, Result};
use redb::{Database, TableDefinition};
use std::path::{Path, PathBuf};
use tracing::{debug, info};

// Table definitions
const TASKS: TableDefinition<&str, &[u8]> = TableDefinition::new("tasks");
const SESSIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("sessions");
const PROOFS: TableDefinition<&str, &[u8]> = TableDefinition::new("proofs");
const CONFIG: TableDefinition<&str, &[u8]> = TableDefinition::new("config");
const DEVICES: TableDefinition<&str, &[u8]> = TableDefinition::new("devices");

/// Embedded database for the AgenC operator
pub struct OperatorDb {
    db: Database,
    path: PathBuf,
}

impl OperatorDb {
    /// Open (or create) the database at the given path.
    /// If `path` is None, uses AGENC_DB_PATH env var or ~/.agenc/operator.redb
    pub fn open(path: Option<&str>) -> Result<Self> {
        let db_path = if let Some(p) = path {
            PathBuf::from(p)
        } else if let Ok(env_path) = std::env::var("AGENC_DB_PATH") {
            PathBuf::from(env_path)
        } else {
            let home = dirs::home_dir().ok_or_else(|| anyhow!("Cannot determine home directory"))?;
            let agenc_dir = home.join(".agenc");
            std::fs::create_dir_all(&agenc_dir)
                .map_err(|e| anyhow!("Failed to create .agenc directory: {}", e))?;
            agenc_dir.join("operator.redb")
        };

        info!("Opening database at: {}", db_path.display());

        let db = Database::create(&db_path)
            .map_err(|e| anyhow!("Failed to open database: {}", e))?;

        // Ensure tables exist by doing a write transaction
        let write_txn = db
            .begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        {
            let _ = write_txn.open_table(TASKS).map_err(|e| anyhow!("Failed to create tasks table: {}", e))?;
            let _ = write_txn.open_table(SESSIONS).map_err(|e| anyhow!("Failed to create sessions table: {}", e))?;
            let _ = write_txn.open_table(PROOFS).map_err(|e| anyhow!("Failed to create proofs table: {}", e))?;
            let _ = write_txn.open_table(CONFIG).map_err(|e| anyhow!("Failed to create config table: {}", e))?;
            let _ = write_txn.open_table(DEVICES).map_err(|e| anyhow!("Failed to create devices table: {}", e))?;
        }
        write_txn.commit().map_err(|e| anyhow!("Failed to commit init: {}", e))?;

        info!("Database ready");

        Ok(Self { db, path: db_path })
    }

    /// Get the database file path
    pub fn path(&self) -> &Path {
        &self.path
    }

    // ========================================================================
    // Task Operations
    // ========================================================================

    pub fn store_task(&self, task: &TaskRecord) -> Result<()> {
        let key = format!("tasks:{}", task.task_id);
        let value = bincode::serialize(task)
            .map_err(|e| anyhow!("Failed to serialize task: {}", e))?;

        let write_txn = self.db.begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        {
            let mut table = write_txn.open_table(TASKS)
                .map_err(|e| anyhow!("Failed to open tasks table: {}", e))?;
            table.insert(key.as_str(), value.as_slice())
                .map_err(|e| anyhow!("Failed to insert task: {}", e))?;
        }
        write_txn.commit().map_err(|e| anyhow!("Failed to commit: {}", e))?;

        debug!("Stored task: {}", task.task_id);
        Ok(())
    }

    pub fn get_task(&self, task_id: &str) -> Result<Option<TaskRecord>> {
        let key = format!("tasks:{}", task_id);

        let read_txn = self.db.begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn.open_table(TASKS)
            .map_err(|e| anyhow!("Failed to open tasks table: {}", e))?;

        match table.get(key.as_str()).map_err(|e| anyhow!("Failed to get task: {}", e))? {
            Some(value) => {
                let task: TaskRecord = bincode::deserialize(value.value())
                    .map_err(|e| anyhow!("Failed to deserialize task: {}", e))?;
                Ok(Some(task))
            }
            None => Ok(None),
        }
    }

    pub fn list_tasks(&self, status_filter: Option<&DbTaskStatus>) -> Result<Vec<TaskRecord>> {
        let read_txn = self.db.begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn.open_table(TASKS)
            .map_err(|e| anyhow!("Failed to open tasks table: {}", e))?;

        let mut results = Vec::new();
        let iter = table.range::<&str>(..)
            .map_err(|e| anyhow!("Failed to iterate tasks: {}", e))?;
        for entry in iter {
            let (_key, value) = entry.map_err(|e| anyhow!("Failed to read entry: {}", e))?;
            let task: TaskRecord = bincode::deserialize(value.value())
                .map_err(|e| anyhow!("Failed to deserialize task: {}", e))?;

            if let Some(filter) = status_filter {
                if &task.status == filter {
                    results.push(task);
                }
            } else {
                results.push(task);
            }
        }
        Ok(results)
    }

    pub fn update_task_status(&self, task_id: &str, status: DbTaskStatus) -> Result<()> {
        let mut task = self
            .get_task(task_id)?
            .ok_or_else(|| anyhow!("Task not found: {}", task_id))?;

        task.status = status.clone();
        if status == DbTaskStatus::Completed {
            task.completed_at = Some(chrono::Utc::now().timestamp());
        }

        self.store_task(&task)?;
        debug!("Updated task {} status to {:?}", task_id, status);
        Ok(())
    }

    // ========================================================================
    // Session Operations
    // ========================================================================

    pub fn store_session(&self, session: &SessionState) -> Result<()> {
        let key = format!("sessions:{}", session.session_id);
        let value = bincode::serialize(session)
            .map_err(|e| anyhow!("Failed to serialize session: {}", e))?;

        let write_txn = self.db.begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        {
            let mut table = write_txn.open_table(SESSIONS)
                .map_err(|e| anyhow!("Failed to open sessions table: {}", e))?;
            table.insert(key.as_str(), value.as_slice())
                .map_err(|e| anyhow!("Failed to insert session: {}", e))?;
        }
        write_txn.commit().map_err(|e| anyhow!("Failed to commit: {}", e))?;

        debug!("Stored session: {}", session.session_id);
        Ok(())
    }

    pub fn get_session(&self, session_id: &str) -> Result<Option<SessionState>> {
        let key = format!("sessions:{}", session_id);

        let read_txn = self.db.begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn.open_table(SESSIONS)
            .map_err(|e| anyhow!("Failed to open sessions table: {}", e))?;

        match table.get(key.as_str()).map_err(|e| anyhow!("Failed to get session: {}", e))? {
            Some(value) => {
                let session: SessionState = bincode::deserialize(value.value())
                    .map_err(|e| anyhow!("Failed to deserialize session: {}", e))?;
                Ok(Some(session))
            }
            None => Ok(None),
        }
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionState>> {
        let read_txn = self.db.begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn.open_table(SESSIONS)
            .map_err(|e| anyhow!("Failed to open sessions table: {}", e))?;

        let mut results = Vec::new();
        let iter = table.range::<&str>(..)
            .map_err(|e| anyhow!("Failed to iterate sessions: {}", e))?;
        for entry in iter {
            let (_key, value) = entry.map_err(|e| anyhow!("Failed to read entry: {}", e))?;
            let session: SessionState = bincode::deserialize(value.value())
                .map_err(|e| anyhow!("Failed to deserialize session: {}", e))?;
            results.push(session);
        }
        Ok(results)
    }

    // ========================================================================
    // Proof Operations
    // ========================================================================

    pub fn store_proof(&self, proof: &VerificationLog) -> Result<()> {
        let key = format!("proofs:{}", proof.task_id);
        let value = bincode::serialize(proof)
            .map_err(|e| anyhow!("Failed to serialize proof: {}", e))?;

        let write_txn = self.db.begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        {
            let mut table = write_txn.open_table(PROOFS)
                .map_err(|e| anyhow!("Failed to open proofs table: {}", e))?;
            table.insert(key.as_str(), value.as_slice())
                .map_err(|e| anyhow!("Failed to insert proof: {}", e))?;
        }
        write_txn.commit().map_err(|e| anyhow!("Failed to commit: {}", e))?;

        debug!("Stored proof for task: {}", proof.task_id);
        Ok(())
    }

    pub fn get_proof(&self, task_id: &str) -> Result<Option<VerificationLog>> {
        let key = format!("proofs:{}", task_id);

        let read_txn = self.db.begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn.open_table(PROOFS)
            .map_err(|e| anyhow!("Failed to open proofs table: {}", e))?;

        match table.get(key.as_str()).map_err(|e| anyhow!("Failed to get proof: {}", e))? {
            Some(value) => {
                let proof: VerificationLog = bincode::deserialize(value.value())
                    .map_err(|e| anyhow!("Failed to deserialize proof: {}", e))?;
                Ok(Some(proof))
            }
            None => Ok(None),
        }
    }

    // ========================================================================
    // Config Operations
    // ========================================================================

    pub fn store_config(&self, config: &OperatorConfig) -> Result<()> {
        let value = bincode::serialize(config)
            .map_err(|e| anyhow!("Failed to serialize config: {}", e))?;

        let write_txn = self.db.begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        {
            let mut table = write_txn.open_table(CONFIG)
                .map_err(|e| anyhow!("Failed to open config table: {}", e))?;
            table.insert("config:operator", value.as_slice())
                .map_err(|e| anyhow!("Failed to insert config: {}", e))?;
        }
        write_txn.commit().map_err(|e| anyhow!("Failed to commit: {}", e))?;

        debug!("Stored operator config");
        Ok(())
    }

    pub fn get_config(&self) -> Result<Option<OperatorConfig>> {
        let read_txn = self.db.begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn.open_table(CONFIG)
            .map_err(|e| anyhow!("Failed to open config table: {}", e))?;

        match table.get("config:operator").map_err(|e| anyhow!("Failed to get config: {}", e))? {
            Some(value) => {
                let config: OperatorConfig = bincode::deserialize(value.value())
                    .map_err(|e| anyhow!("Failed to deserialize config: {}", e))?;
                Ok(Some(config))
            }
            None => Ok(None),
        }
    }

    // ========================================================================
    // Delete Operations
    // ========================================================================

    pub fn delete_task(&self, task_id: &str) -> Result<bool> {
        let key = format!("tasks:{}", task_id);

        let write_txn = self.db.begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        let removed;
        {
            let mut table = write_txn.open_table(TASKS)
                .map_err(|e| anyhow!("Failed to open tasks table: {}", e))?;
            removed = table.remove(key.as_str())
                .map_err(|e| anyhow!("Failed to remove task: {}", e))?
                .is_some();
        }
        write_txn.commit().map_err(|e| anyhow!("Failed to commit delete: {}", e))?;

        if removed {
            debug!("Deleted task: {}", task_id);
        }
        Ok(removed)
    }

    pub fn delete_session(&self, session_id: &str) -> Result<bool> {
        let key = format!("sessions:{}", session_id);

        let write_txn = self.db.begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        let removed;
        {
            let mut table = write_txn.open_table(SESSIONS)
                .map_err(|e| anyhow!("Failed to open sessions table: {}", e))?;
            removed = table.remove(key.as_str())
                .map_err(|e| anyhow!("Failed to remove session: {}", e))?
                .is_some();
        }
        write_txn.commit().map_err(|e| anyhow!("Failed to commit delete: {}", e))?;

        if removed {
            debug!("Deleted session: {}", session_id);
        }
        Ok(removed)
    }

    pub fn delete_proof(&self, task_id: &str) -> Result<bool> {
        let key = format!("proofs:{}", task_id);

        let write_txn = self.db.begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        let removed;
        {
            let mut table = write_txn.open_table(PROOFS)
                .map_err(|e| anyhow!("Failed to open proofs table: {}", e))?;
            removed = table.remove(key.as_str())
                .map_err(|e| anyhow!("Failed to remove proof: {}", e))?
                .is_some();
        }
        write_txn.commit().map_err(|e| anyhow!("Failed to commit delete: {}", e))?;

        if removed {
            debug!("Deleted proof for task: {}", task_id);
        }
        Ok(removed)
    }

    // ========================================================================
    // Pruning Operations
    // ========================================================================

    /// Prune completed tasks older than the given number of days.
    /// Keeps Disputed and Resolved tasks for audit trail.
    /// Returns the number of tasks deleted.
    pub fn prune_completed_tasks(&self, older_than_days: i64) -> Result<usize> {
        let cutoff = chrono::Utc::now().timestamp() - (older_than_days * 86400);
        let tasks = self.list_tasks(Some(&DbTaskStatus::Completed))?;

        let mut deleted = 0;
        for task in &tasks {
            let task_time = task.completed_at.unwrap_or(task.claimed_at);
            if task_time < cutoff {
                if self.delete_task(&task.task_id)? {
                    deleted += 1;
                }
            }
        }

        if deleted > 0 {
            info!("Pruned {} completed tasks older than {} days", deleted, older_than_days);
        }
        Ok(deleted)
    }

    /// Prune sessions older than the given number of days (based on last_active).
    /// Returns the number of sessions deleted.
    pub fn prune_old_sessions(&self, older_than_days: i64) -> Result<usize> {
        let cutoff = chrono::Utc::now().timestamp() - (older_than_days * 86400);
        let sessions = self.list_sessions()?;

        let mut deleted = 0;
        for session in &sessions {
            if session.last_active < cutoff {
                if self.delete_session(&session.session_id)? {
                    deleted += 1;
                }
            }
        }

        if deleted > 0 {
            info!("Pruned {} old sessions older than {} days", deleted, older_than_days);
        }
        Ok(deleted)
    }

    // ========================================================================
    // Statistics
    // ========================================================================

    pub fn stats(&self) -> Result<DbStats> {
        let all_tasks = self.list_tasks(None)?;
        let sessions = self.list_sessions()?;

        // Count proofs
        let read_txn = self.db.begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn.open_table(PROOFS)
            .map_err(|e| anyhow!("Failed to open proofs table: {}", e))?;
        let proof_count = table.range::<&str>(..)
            .map_err(|e| anyhow!("Failed to iterate proofs: {}", e))?
            .count();

        let mut task_counts = std::collections::HashMap::new();
        for task in &all_tasks {
            *task_counts.entry(format!("{:?}", task.status)).or_insert(0usize) += 1;
        }

        Ok(DbStats {
            total_tasks: all_tasks.len(),
            task_counts,
            total_sessions: sessions.len(),
            total_proofs: proof_count,
        })
    }

    // ========================================================================
    // Device Operations (AgenCPI)
    // ========================================================================

    pub fn store_device(&self, device: &crate::types::PairedDevice) -> Result<()> {
        let key = format!("devices:{}", device.device_id);
        let value = bincode::serialize(device)
            .map_err(|e| anyhow!("Failed to serialize device: {}", e))?;

        let write_txn = self.db.begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        {
            let mut table = write_txn.open_table(DEVICES)
                .map_err(|e| anyhow!("Failed to open devices table: {}", e))?;
            table.insert(key.as_str(), value.as_slice())
                .map_err(|e| anyhow!("Failed to insert device: {}", e))?;
        }
        write_txn.commit().map_err(|e| anyhow!("Failed to commit: {}", e))?;

        debug!("Stored paired device: {}", device.device_id);
        Ok(())
    }

    pub fn get_device(&self, device_id: &str) -> Result<Option<crate::types::PairedDevice>> {
        let key = format!("devices:{}", device_id);

        let read_txn = self.db.begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn.open_table(DEVICES)
            .map_err(|e| anyhow!("Failed to open devices table: {}", e))?;

        match table.get(key.as_str()).map_err(|e| anyhow!("Failed to get device: {}", e))? {
            Some(value) => {
                let device: crate::types::PairedDevice = bincode::deserialize(value.value())
                    .map_err(|e| anyhow!("Failed to deserialize device: {}", e))?;
                Ok(Some(device))
            }
            None => Ok(None),
        }
    }

    pub fn list_devices(&self) -> Result<Vec<crate::types::PairedDevice>> {
        let read_txn = self.db.begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn.open_table(DEVICES)
            .map_err(|e| anyhow!("Failed to open devices table: {}", e))?;

        let mut results = Vec::new();
        let iter = table.range::<&str>(..)
            .map_err(|e| anyhow!("Failed to iterate devices: {}", e))?;
        for entry in iter {
            let (_key, value) = entry.map_err(|e| anyhow!("Failed to read entry: {}", e))?;
            let device: crate::types::PairedDevice = bincode::deserialize(value.value())
                .map_err(|e| anyhow!("Failed to deserialize device: {}", e))?;
            results.push(device);
        }
        Ok(results)
    }

    pub fn delete_device(&self, device_id: &str) -> Result<bool> {
        let key = format!("devices:{}", device_id);

        let write_txn = self.db.begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        let removed;
        {
            let mut table = write_txn.open_table(DEVICES)
                .map_err(|e| anyhow!("Failed to open devices table: {}", e))?;
            removed = table.remove(key.as_str())
                .map_err(|e| anyhow!("Failed to remove device: {}", e))?
                .is_some();
        }
        write_txn.commit().map_err(|e| anyhow!("Failed to commit delete: {}", e))?;

        if removed {
            debug!("Deleted device: {}", device_id);
        }
        Ok(removed)
    }

    pub fn update_device_status(&self, device_id: &str, status: crate::types::DeviceStatus) -> Result<()> {
        let mut device = self
            .get_device(device_id)?
            .ok_or_else(|| anyhow!("Device not found: {}", device_id))?;

        device.status = status;
        device.last_seen = chrono::Utc::now().timestamp();
        self.store_device(&device)?;
        debug!("Updated device {} status", device_id);
        Ok(())
    }

    pub fn update_device_config(&self, device_id: &str, config: crate::types::DeviceAgentConfig) -> Result<()> {
        let mut device = self
            .get_device(device_id)?
            .ok_or_else(|| anyhow!("Device not found: {}", device_id))?;

        device.agent_config = Some(config);
        self.store_device(&device)?;
        debug!("Updated device {} config", device_id);
        Ok(())
    }
}
