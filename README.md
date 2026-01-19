# TETSUO - AgenC Operator

> *"I am Tetsuo, your cyberpunk operator for the AgenC protocol. Jacking in..."*

A cyberpunk themed voice controlled desktop operator for the [AgenC Solana protocol](https://github.com/tetsuo-ai/AgenC). Built with Tauri v2 (Rust + React/TypeScript), featuring immersive neon aesthetics, a swappable 2D/3D holographic avatar, and natural voice commands powered by Grok Voice API.


<img width="1407" height="665" alt="image" src="https://github.com/user-attachments/assets/c1df306e-2f2e-46a2-9d33-79ff1348cb63" />



## Features

### Core Features

| Feature | Description |
|---------|-------------|
| **Voice Control** | Natural voice commands for all operations via Grok Voice API |
| **Swappable Avatar** | Toggle between 2.5D SVG/Canvas and full 3D GLB model rendering |
| **Customizable Appearance** | Real-time color pickers, effect toggles, and preset system |
| **Cyberpunk Aesthetics** | Neon glows, glitch effects, scanlines, holographic UI |
| **Local First Security** | Private keys never leave your device |
| **Policy Gate** | Spending operations require verbal + typed/hardware confirmation |
| **Offline Fallback** | Local Whisper ASR when Grok API is unavailable |

### Access Tiers (Token-Gated Features)

| Tier | TETSUO Required | Features |
|------|-----------------|----------|
| **Basic** | 1,000 | Trading (Jupiter swaps, quotes, prices) |
| **Pro** | 10,000 | + Code ops, Twitter, Discord, Email, Image Gen, GitHub |
| **Elite** | 100,000 | + Priority support, early access, custom features |

### Integrations

| Integration | Features |
|-------------|----------|
| **Twitter/X** | OAuth connection, post tweets, post threads |
| **Discord** | Post messages, send embeds to channels |
| **GitHub** | Create gists, issues, comments, trigger workflows |
| **Email** | Send single emails, bulk email campaigns (via Resend) |
| **Jupiter** | Token swaps, price quotes, market data |
| **Grok** | Voice API, code operations, image generation |
| **Memory** | Conversation history with vector embeddings (Qdrant + OpenAI) |

## Architecture

```
agenc-operator/
├── src/                          # React/TypeScript frontend
│   ├── components/
│   │   ├── TetsuoAvatar/         # Swappable avatar system
│   │   │   ├── index.tsx         # Public interface + USE_3D_AVATAR flag
│   │   │   ├── TetsuoAvatar2D.tsx    # SVG/Canvas fallback renderer
│   │   │   ├── TetsuoAvatar3D.tsx    # Three.js GLB renderer
│   │   │   └── ErrorBoundary.tsx     # Graceful 3D failure handling
│   │   ├── AppearanceMenu.tsx    # Customization panel
│   │   ├── WalletDropdown.tsx    # Wallet connection dropdown
│   │   ├── TwitterConnect.tsx    # Twitter OAuth component
│   │   ├── AccessTierBadge.tsx   # Token tier display
│   │   ├── GatedFeature.tsx      # Feature gating wrapper
│   │   ├── TaskMarketplace.tsx   # Task browser
│   │   ├── GlitchOverlay.tsx     # Visual effects layer
│   │   ├── ChatPanel.tsx         # Message history
│   │   ├── VoiceButton.tsx       # Voice activation
│   │   ├── TitleBar.tsx          # Custom window controls
│   │   └── StatusBar.tsx         # System status
│   ├── hooks/
│   │   ├── useVoicePipeline.ts   # Grok Voice API integration
│   │   ├── useAppStore.ts        # Zustand state + appearance persistence
│   │   └── useMouthAnimation.ts  # Avatar mouth sync
│   ├── types/
│   │   └── index.ts              # TypeScript definitions
│   ├── styles/
│   │   ├── globals.css           # Cyberpunk styling
│   │   └── palette.ts            # Neon color palette
│   ├── api/
│   │   └── index.ts              # Tauri IPC layer
│   ├── App.tsx                   # Main application
│   └── main.tsx                  # Entry point
├── src-tauri/                    # Tauri Rust backend
│   ├── src/
│   │   ├── lib.rs                # IPC command handlers
│   │   └── main.rs               # Entry point
│   └── tauri.conf.json           # Tauri configuration
├── crates/
│   └── operator-core/            # Core Rust library
│       ├── src/
│       │   ├── lib.rs
│       │   ├── solana_exec.rs    # Solana transaction building
│       │   ├── voice_local.rs    # Whisper offline ASR
│       │   ├── policy_gate.rs    # Security confirmations
│       │   ├── types.rs          # Shared data structures
│       │   ├── transaction_retry.rs  # Robust tx submission
│       │   ├── access/           # Access tier system
│       │   │   ├── mod.rs
│       │   │   ├── gate.rs       # Token-gated feature checks
│       │   │   ├── checker.rs    # Balance verification
│       │   │   └── types.rs      # Tier definitions
│       │   ├── auth/             # Authentication
│       │   │   ├── mod.rs
│       │   │   └── twitter_oauth.rs  # Twitter OAuth flow
│       │   ├── executor/         # Action executors
│       │   │   ├── mod.rs
│       │   │   ├── twitter.rs    # Tweet/thread posting
│       │   │   ├── discord.rs    # Discord messages
│       │   │   ├── github.rs     # Gists, issues, workflows
│       │   │   ├── email.rs      # Email sending
│       │   │   ├── image.rs      # Image generation
│       │   │   ├── jupiter_swap.rs   # Token trading
│       │   │   ├── grok_code.rs  # Code operations
│       │   │   └── slack.rs      # Slack integration
│       │   └── memory/           # Conversation memory
│       │       ├── mod.rs
│       │       ├── manager.rs    # Memory orchestration
│       │       ├── store.rs      # Qdrant vector store
│       │       ├── embeddings.rs # OpenAI embeddings
│       │       └── types.rs      # Memory types
│       └── Cargo.toml
├── public/
│   └── models/
│       └── avatar.glb            # 3D avatar model (user provided)
├── docker-compose.yml            # Qdrant + services
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## Prerequisites

| Requirement | Version | Installation |
|-------------|---------|--------------|
| **Rust** | 1.75+ | https://rustup.rs/ |
| **Node.js** | 18+ | https://nodejs.org/ |
| **Solana CLI** | 2.0+ | https://docs.solana.com/cli/install-solana-cli-tools |
| **Tauri CLI** | 2.0+ | `cargo install tauri-cli` |

### Platform Specific

**Windows:**
```
Visual Studio Build Tools with C++ workload
WebView2 Runtime (pre-installed on Windows 11)
```

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/piccassol/agenc-operator.git
cd agenc-operator
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Core
VITE_XAI_API_KEY=your_xai_api_key_here
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_SOLANA_NETWORK=devnet
SOLANA_KEYPAIR_PATH=~/.config/solana/id.json

# Access Tier (TETSUO token mint)
TETSUO_MINT=your_tetsuo_token_mint_address

# Twitter Integration
TWITTER_CLIENT_ID=your_twitter_client_id
TWITTER_CLIENT_SECRET=your_twitter_client_secret
TWITTER_REDIRECT_URI=http://localhost:1420/auth/twitter/callback

# Discord Integration
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_DEFAULT_SERVER_ID=your_server_id

# GitHub Integration
GITHUB_TOKEN=your_github_personal_access_token
GITHUB_DEFAULT_OWNER=your_github_username
GITHUB_DEFAULT_REPO=your_default_repo

# Email (Resend)
RESEND_API_KEY=your_resend_api_key
EMAIL_FROM=noreply@yourdomain.com

# Memory System (uses OpenAI for embeddings)
QDRANT_URL=http://localhost:6333
OPENAI_API_KEY=your_openai_api_key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Optional: Local Whisper fallback
VITE_ENABLE_LOCAL_WHISPER=false
```

### 3. Add 3D Avatar Model (Optional)

Place your GLB model at:

```bash
mkdir -p public/models
cp /path/to/your/avatar.glb public/models/avatar.glb
```

The avatar system will automatically fall back to 2D if no model is present.

### 4. Run Development Server

```bash
npm run tauri:dev
```

### 5. Build for Production

```bash
npm run tauri:build
```

Bundles are created in `src-tauri/target/release/bundle/`.

## Avatar System

The avatar system supports both 2.5D (SVG/Canvas) and 3D (Three.js/GLB) rendering with a single flag toggle.

### Switching Between 2D and 3D

Edit `src/components/TetsuoAvatar/index.tsx`:

```typescript
// Set to true for 3D GLB model, false for 2D SVG fallback
export const USE_3D_AVATAR = true;
```

### 3D Model Requirements

| Property | Value |
|----------|-------|
| **Format** | GLB (binary glTF) |
| **Location** | `public/models/avatar.glb` |
| **Recommended Size** | Under 10MB |
| **Materials** | PBR supported via Environment lighting |

The 3D renderer automatically:
1. Computes bounding box
2. Centers the model
3. Logs dimensions to console for debugging
4. Falls back to 2D if loading fails

### Debugging 3D Models

Open browser DevTools console and look for:

```
[TetsuoAvatar3D] GLB bbox size: Vector3 {...} center: Vector3 {...} radius: X
```

Use OrbitControls (click and drag) in development mode to inspect the model.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `C` | Toggle appearance customization menu |
| `Escape` | Close customization menu |

## Appearance Customization

Click the avatar or press `C` to open the customization panel.

### Available Options

| Category | Controls |
|----------|----------|
| **Nameplate** | Custom display name |
| **Colors** | Accent, Hair, Eye Glow (hex color pickers) |
| **Effects** | Scanlines, Noise, RGB Split, Vignette, Bloom |
| **Intensity** | Global effects intensity slider (0 to 100%) |
| **Presets** | Save/load appearance configurations |

### Persistence

All appearance settings are automatically saved to localStorage and restored on app restart.

### Programmatic Access

```typescript
import { useAppStore } from './hooks/useAppStore';

// Get current appearance
const appearance = useAppStore((state) => state.appearance);

// Update appearance
const updateAppearance = useAppStore((state) => state.updateAppearance);
updateAppearance({ accentColor: '#ff00ff' });

// Save preset
const savePreset = useAppStore((state) => state.savePreset);
const presetId = savePreset('My Theme', appearance);

// Load preset
const loadPreset = useAppStore((state) => state.loadPreset);
loadPreset(presetId);
```

## Voice Commands

Activate voice by clicking the center button or saying "Hey Tetsuo".

### Task Management

| Command | Action |
|---------|--------|
| "Create a task to audit the swap program with 0.5 SOL reward" | Create new task |
| "List open tasks" | Show available tasks |
| "Claim task 001" | Claim a task |
| "Complete task 001" | Submit task completion |
| "Cancel task 001" | Cancel your task |

### Wallet & Protocol

| Command | Action |
|---------|--------|
| "What's my balance?" | Check SOL balance |
| "Get my address" | Show wallet address |
| "Protocol status" | Show protocol stats |

### Trading (Basic Tier)

| Command | Action |
|---------|--------|
| "Swap 1 SOL for USDC" | Execute token swap via Jupiter |
| "Get quote for 100 USDC to SOL" | Get swap quote |
| "What's the price of BONK?" | Get token price |

### Social (Pro Tier)

| Command | Action |
|---------|--------|
| "Post tweet: Just shipped a new feature!" | Post to Twitter/X |
| "Post thread about Solana development" | Post Twitter thread |
| "Send Discord message to general: Hello!" | Post to Discord channel |

### Code Operations (Pro Tier)

| Command | Action |
|---------|--------|
| "Review the code in src/App.tsx" | Get code review |
| "Fix the bug in utils.ts" | AI-assisted code fix |
| "Generate a React component for user profile" | Generate code |
| "Explain the solana_exec.rs file" | Code explanation |

### GitHub (Pro Tier)

| Command | Action |
|---------|--------|
| "Create a gist with my config file" | Create GitHub gist |
| "Open issue: Fix memory leak in worker" | Create GitHub issue |
| "Comment on issue 42: This is resolved" | Add issue comment |
| "Trigger the deploy workflow" | Run GitHub Action |

### Email (Pro Tier)

| Command | Action |
|---------|--------|
| "Send email to team@example.com about the release" | Send single email |
| "Send bulk email to newsletter subscribers" | Bulk email |

### Image Generation (Pro Tier)

| Command | Action |
|---------|--------|
| "Generate an image of a cyberpunk city" | AI image generation via Grok |

### System

| Command | Action |
|---------|--------|
| "Help" | List available commands |

## Security Model

Tetsuo implements a **local first security model**:

| Operation Type | Confirmation Required |
|----------------|----------------------|
| Read operations | None |
| Small amounts (< 0.1 SOL) | Verbal |
| Medium amounts | Typed |
| Large amounts (> 1 SOL) | Hardware wallet |
| Session limit | Max 10 SOL without hardware |

Keys never leave the device. Policy rules can be customized in `crates/operator-core/src/policy_gate.rs`.

## Voice Pipeline

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  Microphone │───▶│  Web Audio   │───▶│ Grok Voice  │
│   (cpal)    │    │     API      │    │ API (WSS)   │
└─────────────┘    └──────────────┘    └──────┬──────┘
                                              │
                   ┌──────────────────────────┘
                   ▼
           ┌───────────────┐    ┌─────────────┐
           │ Intent Parser │───▶│ Policy Gate │
           │   (JSON)      │    │   Check     │
           └───────────────┘    └──────┬──────┘
                                       │
                   ┌───────────────────┘
                   ▼
           ┌───────────────┐    ┌─────────────┐
           │    Solana     │───▶│   Update    │
           │   Executor    │    │     UI      │
           └───────────────┘    └─────────────┘
```

### Offline Fallback

When Grok API is unavailable:

1. Download `ggml-base.en.bin` from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp)
2. Place in `./models/`
3. Set `VITE_ENABLE_LOCAL_WHISPER=true` in `.env`

## Type Definitions

### AgentAppearance

```typescript
interface AgentAppearance {
  nameplate: string;
  accentColor: string;      // hex
  hairColor: string;        // hex
  eyeGlowColor: string;     // hex
  effects: {
    scanlines: boolean;
    noise: boolean;
    rgbSplit: boolean;
    vignette: boolean;
    bloom: boolean;
  };
  effectsIntensity: number; // 0 to 1
  presetId?: string;
}
```

### AgentStatus

```typescript
interface AgentStatus {
  online: boolean;
  network: 'localnet' | 'devnet' | 'mainnet';
  walletConnected: boolean;
  micActive: boolean;
  lastHeard?: string;
  mode: 'idle' | 'listening' | 'speaking' | 'thinking' | 'error';
}
```

## Development

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build frontend for production |
| `npm run typecheck` | Run TypeScript type checker |
| `npm run tauri:dev` | Start Tauri dev mode |
| `npm run tauri:build` | Build Tauri app for production |

### Adding New Avatar Effects

1. Add effect boolean to `AgentAppearance.effects` in `src/types/index.ts`
2. Update `DEFAULT_APPEARANCE` with default value
3. Add toggle in `src/components/AppearanceMenu.tsx`
4. Implement effect in both `TetsuoAvatar2D.tsx` and `TetsuoAvatar3D.tsx`

### Testing

```bash
# TypeScript type check
npm run typecheck

# Rust tests
cargo test --workspace
```

## Dependencies

### TypeScript

| Package | Purpose |
|---------|---------|
| `@tauri-apps/api` | Tauri IPC |
| `react` | UI framework |
| `framer-motion` | Animations |
| `zustand` | State management |
| `tailwindcss` | Styling |
| `three` | 3D rendering |
| `@react-three/fiber` | React Three.js renderer |
| `@react-three/drei` | Three.js utilities |

### Rust

| Crate | Purpose |
|-------|---------|
| `tauri` v2.0 | Desktop framework |
| `solana-sdk` v2.0 | Solana transactions |
| `tokio` | Async runtime |
| `whisper-rs` | Local ASR (optional) |
| `cpal/rodio` | Audio capture/playback |

## Roadmap

| Status | Feature |
|--------|---------|
| Done | Swappable 2D/3D avatar system |
| Done | Appearance customization with presets |
| Done | localStorage persistence |
| Done | Token-gated access tiers (TETSUO) |
| Done | Twitter OAuth + posting |
| Done | Discord integration |
| Done | GitHub operations (gists, issues, workflows) |
| Done | Email sending (Resend) |
| Done | Jupiter swap integration |
| Done | Grok image generation |
| Done | Memory system with Qdrant |
| Done | Transaction retry with backoff |
| Planned | Hardware wallet integration (Ledger) |
| Planned | Multi-language support |
| Planned | Mobile companion app |
| Planned | DAO governance integration |

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing`
5. Open Pull Request

## License

MIT License. See [LICENSE](LICENSE) for details.

## Credits

Built with love for the Solana ecosystem.

| Technology | Provider |
|------------|----------|
| Grok Voice API | X.AI |
| Tauri | Tauri Team |
| Solana SDK | Solana Labs |
| Three.js | mrdoob |
| React Three Fiber | Poimandres |

---

*"The future is already here. It's just not evenly distributed."*
