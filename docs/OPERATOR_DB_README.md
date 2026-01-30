# AgenC Operator Database

Persistent storage layer for AgenC operator instances. Each operator runs its own embedded database to cache task state, session context, and verification logs without depending on external infrastructure.

## Why Embedded

Operators need to function independently. Spinning up Postgres or some managed db for each operator instance adds friction and failure points. An embedded database means the operator binary is self contained. One file, runs anywhere.

We went with redb over sled. Both are pure Rust and battle tested but redb has a cleaner API and less complexity for what we actually need. ACID transactions, single file storage, no external deps.

## What Gets Stored

**Task Cache**
Local mirror of on chain task state. When an operator claims a task from the marketplace we store the full task payload, timestamps, and status locally. This lets us handle RPC failures gracefully and maintain history for dispute resolution without hammering the chain.

**Session State**
Conversation context for the voice interface. Transcripts, command history, active task references. This persists across restarts so operators can pick up where they left off.

**Verification Logs**
Proof of work records. Every task completion generates a verification entry with inputs, outputs, and cryptographic proofs. These are critical for the dispute resolution system and get submitted on chain when challenged.

**Operator Config**
Keypairs, RPC endpoints, model preferences, registered capabilities. Loaded on startup.

## Schema

Using a simple key value model with prefixed namespaces. All values are bincode serialized structs.

```
tasks:{task_id}        -> TaskRecord
sessions:{session_id}  -> SessionState  
proofs:{task_id}       -> VerificationLog
config:operator        -> OperatorConfig
```

## Implementation

```rust
use redb::{Database, ReadableTable, TableDefinition};
use serde::{Deserialize, Serialize};

const TASKS: TableDefinition<&str, &[u8]> = TableDefinition::new("tasks");
const SESSIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("sessions");
const PROOFS: TableDefinition<&str, &[u8]> = TableDefinition::new("proofs");
const CONFIG: TableDefinition<&str, &[u8]> = TableDefinition::new("config");

#[derive(Serialize, Deserialize)]
pub struct TaskRecord {
    pub task_id: String,
    pub payload: Vec<u8>,
    pub status: TaskStatus,
    pub claimed_at: i64,
    pub completed_at: Option<i64>,
    pub on_chain_signature: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub enum TaskStatus {
    Claimed,
    InProgress,
    Completed,
    Disputed,
    Resolved,
}

pub struct OperatorDb {
    db: Database,
}

impl OperatorDb {
    pub fn open(path: &str) -> Result<Self, redb::Error> {
        let db = Database::create(path)?;
        Ok(Self { db })
    }

    pub fn store_task(&self, task: &TaskRecord) -> Result<(), redb::Error> {
        let key = format!("tasks:{}", task.task_id);
        let value = bincode::serialize(task).unwrap();
        
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(TASKS)?;
            table.insert(key.as_str(), value.as_slice())?;
        }
        write_txn.commit()?;
        Ok(())
    }

    pub fn get_task(&self, task_id: &str) -> Result<Option<TaskRecord>, redb::Error> {
        let key = format!("tasks:{}", task_id);
        
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(TASKS)?;
        
        match table.get(key.as_str())? {
            Some(value) => {
                let task: TaskRecord = bincode::deserialize(value.value()).unwrap();
                Ok(Some(task))
            }
            None => Ok(None),
        }
    }

    pub fn list_tasks_by_status(&self, status: TaskStatus) -> Result<Vec<TaskRecord>, redb::Error> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(TASKS)?;
        
        let mut results = Vec::new();
        for entry in table.iter()? {
            let (_, value) = entry?;
            let task: TaskRecord = bincode::deserialize(value.value()).unwrap();
            if std::mem::discriminant(&task.status) == std::mem::discriminant(&status) {
                results.push(task);
            }
        }
        Ok(results)
    }
}
```

## Dependencies

Add to Cargo.toml:

```toml
[dependencies]
redb = "2.4"
bincode = "1.3"
serde = { version = "1.0", features = ["derive"] }
```

## File Location

Default path is `~/.agenc/operator.redb`. Configurable via env var `AGENC_DB_PATH` or cli flag.

## Migrations

No formal migration system yet. For now schema changes mean wiping the db and resyncing from chain. Task history can be reconstructed from on chain events. Session state is ephemeral anyway.

If we need proper migrations later we can version the db file and add upgrade logic on open.

## Performance Notes

redb handles concurrent reads fine but writes are serialized. For our use case this is not a bottleneck since operators process tasks sequentially anyway. If we ever need parallel task execution we can shard by task id or switch to a different storage backend.

The db file grows unbounded currently. Adding a pruning job to clean up completed tasks older than X days is on the list.

## Next Steps

1. Wire up to main operator loop
2. Add session state serialization for voice context
3. Implement verification log format that matches on chain proof schema
4. Build cli commands for db inspection and export
5. Add metrics for storage size and operation latency
