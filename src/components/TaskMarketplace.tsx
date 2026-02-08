/**
 * ============================================================================
 * TaskMarketplace - Cyberpunk Task Browser & Management
 * ============================================================================
 * Displays open tasks in the AgenC protocol with:
 * - Task listing with reward amounts
 * - Task details panel
 * - Claim/Complete/Cancel actions
 * - Cyberpunk neon styling
 * ============================================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TetsuoAPI } from '../api';
import type { AgencTask, TaskStatus, WalletInfo } from '../types';
import { lamportsToSol, skrTokensToDisplay } from '../types';
import { useNotificationStore } from '../stores/notificationStore';

interface TaskMarketplaceProps {
  wallet?: WalletInfo | null;
  onTaskAction?: (action: string, taskId: string) => void;
  onTaskCountChange?: (count: number) => void;
}

export default function TaskMarketplace({
  wallet,
  onTaskAction,
  onTaskCountChange,
}: TaskMarketplaceProps) {
  const [tasks, setTasks] = useState<AgencTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<AgencTask | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskStatus | 'all' | 'mine'>('open');
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const prevTaskIdsRef = useRef<Set<string>>(new Set());
  const addToast = useNotificationStore((s) => s.addToast);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      // "mine" filter fetches all then filters client-side
      const apiFilter = (filter === 'all' || filter === 'mine') ? undefined : filter;
      let result = await TetsuoAPI.task.listTasks(apiFilter);

      if (filter === 'mine' && wallet?.address) {
        result = result.filter(
          (t) => t.creator === wallet.address || t.claimer === wallet.address
        );
      }

      // Detect new tasks for notification
      const newIds = new Set(result.map((t) => t.id));
      if (prevTaskIdsRef.current.size > 0) {
        const added = result.filter((t) => !prevTaskIdsRef.current.has(t.id));
        if (added.length > 0) {
          addToast({
            type: 'info',
            title: `${added.length} new task${added.length > 1 ? 's' : ''}`,
            message: added[0]?.description.slice(0, 60),
          });
        }
      }
      prevTaskIdsRef.current = newIds;

      setTasks(result);
      onTaskCountChange?.(result.length);
    } catch (err) {
      setError(`Failed to load tasks: ${err}`);
      console.error('[TaskMarketplace] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filter, wallet?.address, addToast, onTaskCountChange]);

  useEffect(() => {
    fetchTasks();
    // Refresh every 30 seconds
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Task actions
  const handleClaim = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      await TetsuoAPI.task.claimTask(taskId);
      addToast({ type: 'success', title: 'Task Claimed', message: `#${taskId.slice(0, 8)}...` });
      onTaskAction?.('claim', taskId);
      await fetchTasks();
    } catch (err) {
      addToast({ type: 'error', title: 'Claim Failed', message: `${err}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleComplete = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      await TetsuoAPI.task.completeTask(taskId);
      addToast({ type: 'success', title: 'Task Completed', message: 'Reward incoming!' });
      onTaskAction?.('complete', taskId);
      await fetchTasks();
    } catch (err) {
      addToast({ type: 'error', title: 'Complete Failed', message: `${err}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      await TetsuoAPI.task.cancelTask(taskId);
      addToast({ type: 'success', title: 'Task Cancelled', message: 'Reward returned.' });
      onTaskAction?.('cancel', taskId);
      await fetchTasks();
    } catch (err) {
      addToast({ type: 'error', title: 'Cancel Failed', message: `${err}` });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateTask = async (desc: string, solReward: number, skrReward: number, deadlineHrs: number) => {
    setActionLoading('create');
    try {
      await TetsuoAPI.task.createTask(desc, solReward, skrReward || undefined, deadlineHrs || undefined);
      addToast({ type: 'success', title: 'Task Created', message: `${solReward} SOL reward` });
      setShowCreateForm(false);
      await fetchTasks();
    } catch (err) {
      addToast({ type: 'error', title: 'Create Failed', message: `${err}` });
    } finally {
      setActionLoading(null);
    }
  };

  // Status colors — includes on-chain states
  const statusColors: Record<TaskStatus, string> = {
    open: 'text-neon-green',
    claimed: 'text-neon-cyan',
    in_progress: 'text-neon-cyan',
    pending_validation: 'text-yellow-400',
    completed: 'text-neon-purple',
    cancelled: 'text-holo-silver/50',
    disputed: 'text-neon-magenta',
  };

  const statusBgColors: Record<TaskStatus, string> = {
    open: 'bg-neon-green/10 border-neon-green/30',
    claimed: 'bg-neon-cyan/10 border-neon-cyan/30',
    in_progress: 'bg-neon-cyan/10 border-neon-cyan/30',
    pending_validation: 'bg-yellow-400/10 border-yellow-400/30',
    completed: 'bg-neon-purple/10 border-neon-purple/30',
    cancelled: 'bg-holo-silver/10 border-holo-silver/30',
    disputed: 'bg-neon-magenta/10 border-neon-magenta/30',
  };

  const truncateAddress = (addr: string): string => {
    if (!addr || addr.length < 10) return addr || '';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  const isOwner = (task: AgencTask) =>
    wallet?.address && task.creator === wallet.address;

  const isClaimer = (task: AgencTask) =>
    wallet?.address && task.claimer === wallet.address;

  return (
    <motion.div
      className="cyber-panel overflow-hidden border-neon-cyan/30 w-full max-w-2xl"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-neon-cyan/30 bg-gradient-to-r from-neon-cyan/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Pulse indicator */}
            <motion.div
              className="w-2 h-2 rounded-full bg-neon-cyan"
              animate={{
                opacity: [1, 0.5, 1],
                scale: [1, 0.9, 1],
              }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <h2 className="font-display text-sm uppercase tracking-widest text-neon-cyan">
              Task Marketplace
            </h2>
          </div>

          {/* Filter + Create */}
          <div className="flex gap-1 items-center">
            {(['all', 'open', 'claimed', 'mine'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 text-[10px] uppercase tracking-wider rounded border transition-colors
                  ${filter === f
                    ? 'bg-neon-cyan/20 border-neon-cyan/50 text-neon-cyan'
                    : 'bg-transparent border-white/10 text-white/50 hover:border-white/30'
                  }`}
              >
                {f}
              </button>
            ))}
            {wallet?.is_connected && (
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className={`ml-1 px-2 py-1 text-[10px] uppercase tracking-wider rounded border transition-colors
                  ${showCreateForm
                    ? 'bg-neon-green/20 border-neon-green/50 text-neon-green'
                    : 'bg-transparent border-neon-green/30 text-neon-green/70 hover:border-neon-green/50'
                  }`}
              >
                + new
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="px-4 py-2 bg-neon-magenta/10 border-b border-neon-magenta/30 text-neon-magenta text-xs"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-white/50 hover:text-white"
            >
              [dismiss]
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Task Form */}
      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            className="px-4 py-3 border-b border-neon-green/20 bg-neon-green/5"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <CreateTaskForm
              loading={actionLoading === 'create'}
              onSubmit={handleCreateTask}
              onCancel={() => setShowCreateForm(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Task List */}
      <div className="max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
        {isLoading ? (
          <div className="p-8 text-center">
            <motion.div
              className="inline-block w-8 h-8 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            <p className="mt-2 text-xs text-holo-silver/50">Loading tasks...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-8 text-center text-holo-silver/50">
            <p className="text-sm">No tasks found</p>
            <p className="text-xs mt-1">Try a different filter or check back later</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {tasks.map((task) => (
              <motion.div
                key={task.id}
                className={`p-4 cursor-pointer transition-colors hover:bg-white/5
                  ${selectedTask?.id === task.id ? 'bg-neon-cyan/5' : ''}`}
                onClick={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
                layout
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Task Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded border
                          ${statusBgColors[task.status]}`}
                      >
                        <span className={statusColors[task.status]}>{task.status}</span>
                      </span>
                      <span className="text-[10px] text-holo-silver/40 font-mono">
                        #{task.id.slice(0, 8)}
                      </span>
                    </div>
                    <p className="text-sm text-white/80 line-clamp-2">{task.description}</p>
                    <div className="mt-1 text-[10px] text-holo-silver/40">
                      by {truncateAddress(task.creator)}
                      {task.claimer && (
                        <span> · claimed by {truncateAddress(task.claimer)}</span>
                      )}
                    </div>
                  </div>

                  {/* Reward */}
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono text-lg text-neon-green">
                      {lamportsToSol(task.reward_lamports).toFixed(2)}
                    </div>
                    <div className="text-[10px] text-holo-silver/50">SOL</div>
                    {(task.reward_skr_tokens ?? 0) > 0 && (
                      <>
                        <div className="font-mono text-sm text-neon-purple mt-0.5">
                          +{skrTokensToDisplay(task.reward_skr_tokens!).toFixed(0)}
                        </div>
                        <div className="text-[10px] text-holo-silver/50">SKR</div>
                      </>
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                <AnimatePresence>
                  {selectedTask?.id === task.id && (
                    <motion.div
                      className="mt-4 pt-4 border-t border-white/10"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      {/* Task Details */}
                      <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                        <div>
                          <span className="text-holo-silver/50">Created:</span>
                          <span className="ml-2 text-white/70">
                            {new Date(task.created_at * 1000).toLocaleDateString()}
                          </span>
                        </div>
                        {task.deadline && (
                          <div>
                            <span className="text-holo-silver/50">Deadline:</span>
                            <span className="ml-2 text-white/70">
                              {new Date(task.deadline * 1000).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                        <div className="col-span-2">
                          <span className="text-holo-silver/50">Creator:</span>
                          <span className="ml-2 text-white/70 font-mono">{task.creator}</span>
                        </div>
                        {task.claimer && (
                          <div className="col-span-2">
                            <span className="text-holo-silver/50">Claimer:</span>
                            <span className="ml-2 text-white/70 font-mono">{task.claimer}</span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 justify-end">
                        {/* Claim - if open and not owner */}
                        {task.status === 'open' && !isOwner(task) && wallet?.is_connected && (
                          <ActionButton
                            label="Claim Task"
                            color="cyan"
                            loading={actionLoading === task.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClaim(task.id);
                            }}
                          />
                        )}

                        {/* Complete - if claimed/in_progress by current user */}
                        {(task.status === 'claimed' || task.status === 'in_progress') && isClaimer(task) && (
                          <ActionButton
                            label="Mark Complete"
                            color="green"
                            loading={actionLoading === task.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleComplete(task.id);
                            }}
                          />
                        )}

                        {/* Cancel - if owner and open/claimed */}
                        {['open', 'claimed'].includes(task.status) && isOwner(task) && (
                          <ActionButton
                            label="Cancel Task"
                            color="magenta"
                            loading={actionLoading === task.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancel(task.id);
                            }}
                          />
                        )}

                        {/* No actions available message */}
                        {!wallet?.is_connected && (
                          <span className="text-xs text-holo-silver/50 py-2">
                            Connect wallet to interact
                          </span>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Footer - Stats */}
      <div className="px-4 py-2 border-t border-neon-cyan/30 bg-gradient-to-r from-transparent to-neon-cyan/5">
        <div className="flex justify-between text-[10px] text-holo-silver/50">
          <span>{tasks.length} tasks</span>
          <span>
            {tasks.reduce((acc, t) => acc + lamportsToSol(t.reward_lamports), 0).toFixed(2)} SOL
            {(() => {
              const totalSkr = tasks.reduce((acc, t) => acc + skrTokensToDisplay(t.reward_skr_tokens ?? 0), 0);
              return totalSkr > 0 ? ` + ${totalSkr.toFixed(0)} SKR` : '';
            })()}
          </span>
        </div>
      </div>

      {/* Decorative Corners */}
      <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-neon-cyan/30" />
      <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-neon-cyan/30" />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-neon-cyan/30" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-neon-cyan/30" />
    </motion.div>
  );
}

// ============================================================================
// Action Button Component
// ============================================================================

interface ActionButtonProps {
  label: string;
  color: 'cyan' | 'green' | 'magenta' | 'purple';
  loading?: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
}

function ActionButton({ label, color, loading, disabled, onClick }: ActionButtonProps) {
  const colors = {
    cyan: 'border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10',
    green: 'border-neon-green/50 text-neon-green hover:bg-neon-green/10',
    magenta: 'border-neon-magenta/50 text-neon-magenta hover:bg-neon-magenta/10',
    purple: 'border-neon-purple/50 text-neon-purple hover:bg-neon-purple/10',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border transition-colors
        ${colors[color]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {loading ? (
        <motion.span
          className="inline-block"
          animate={{ opacity: [1, 0.5, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        >
          Processing...
        </motion.span>
      ) : (
        label
      )}
    </button>
  );
}

// ============================================================================
// Create Task Form Component
// ============================================================================

interface CreateTaskFormProps {
  loading: boolean;
  onSubmit: (description: string, solReward: number, skrReward: number, deadlineHrs: number) => void;
  onCancel: () => void;
}

function CreateTaskForm({ loading, onSubmit, onCancel }: CreateTaskFormProps) {
  const [desc, setDesc] = useState('');
  const [solReward, setSolReward] = useState('0.1');
  const [skrReward, setSkrReward] = useState('');
  const [deadline, setDeadline] = useState('');

  const canSubmit = desc.trim().length > 0 && parseFloat(solReward) > 0 && !loading;

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-neon-green/70 mb-1">
        Create New Task
      </div>

      {/* Description */}
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Task description..."
        rows={2}
        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-white/80
          placeholder:text-white/30 focus:outline-none focus:border-neon-green/40 resize-none"
      />

      {/* Rewards row */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[9px] text-holo-silver/50 uppercase">SOL Reward</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={solReward}
            onChange={(e) => setSolReward(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-neon-green
              font-mono focus:outline-none focus:border-neon-green/40"
          />
        </div>
        <div className="flex-1">
          <label className="text-[9px] text-holo-silver/50 uppercase">SKR Reward</label>
          <input
            type="number"
            step="1"
            min="0"
            value={skrReward}
            onChange={(e) => setSkrReward(e.target.value)}
            placeholder="0"
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-neon-purple
              font-mono placeholder:text-white/20 focus:outline-none focus:border-neon-purple/40"
          />
        </div>
        <div className="flex-1">
          <label className="text-[9px] text-holo-silver/50 uppercase">Deadline (hrs)</label>
          <input
            type="number"
            step="1"
            min="0"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            placeholder="--"
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white/70
              font-mono placeholder:text-white/20 focus:outline-none focus:border-white/30"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1 text-[10px] uppercase tracking-wider text-white/50 hover:text-white/80"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit(desc.trim(), parseFloat(solReward) || 0, parseFloat(skrReward) || 0, parseInt(deadline) || 0)}
          disabled={!canSubmit}
          className={`px-3 py-1.5 text-[10px] uppercase tracking-wider rounded border transition-colors
            border-neon-green/50 text-neon-green hover:bg-neon-green/10
            ${!canSubmit ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {loading ? 'Creating...' : 'Create Task'}
        </button>
      </div>
    </div>
  );
}
