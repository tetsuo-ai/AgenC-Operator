# TETSUO - AgenC Operator

> *"I am Tetsuo, your cyberpunk operator for the AgenC protocol. Jacking in..."*

A cyberpunk themed voice controlled desktop operator for the [AgenC Solana protocol](https://github.com/tetsuo-ai/AgenC). Built with Tauri v2 (Rust + React/TypeScript), featuring immersive neon aesthetics, a swappable 2D/3D holographic avatar, and natural voice commands powered by Grok Voice API.


![6a8e96fc-39aa-4913-bb2e-b4c7f0147531](https://github.com/user-attachments/assets/2227543b-c7f3-423a-ada6-823038f72ff0)


## Features

| Feature | Description |
|---------|-------------|
| **Voice Control** | Create tasks, check balances, list open tasks through natural voice commands |
| **Swappable Avatar** | Toggle between 2.5D SVG/Canvas and full 3D GLB model rendering |
| **Customizable Appearance** | Real time color pickers, effect toggles, and preset system |
| **Cyberpunk Aesthetics** | Neon glows, glitch effects, scanlines, holographic UI |
| **Local First Security** | Private keys never leave your device |
| **Policy Gate** | Spending operations require verbal + typed/hardware confirmation |
| **Offline Fallback** | Local Whisper ASR when Grok API is unavailable |
| **Real Time Protocol State** | HUD displays open tasks, TVL, and active operators |

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
│   │   ├── TetsuoHologram.tsx    # Legacy avatar (deprecated)
│   │   ├── GlitchOverlay.tsx     # Visual effects layer
│   │   ├── HudPanel.tsx          # Protocol state display
│   │   ├── ChatPanel.tsx         # Message history
│   │   ├── VoiceButton.tsx       # Voice activation
│   │   ├── TitleBar.tsx          # Custom window controls
│   │   └── StatusBar.tsx         # System status
│   ├── hooks/
│   │   ├── useVoicePipeline.ts   # Grok Voice API integration
│   │   └── useAppStore.ts        # Zustand state + appearance persistence
│   ├── types/
│   │   └── index.ts              # TypeScript definitions
│   ├── styles/
│   │   └── globals.css           # Cyberpunk styling
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
│       │   └── types.rs          # Shared data structures
│       └── Cargo.toml
├── public/
│   └── models/
│       └── avatar.glb            # 3D avatar model (user provided)
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
# Grok Voice API (get from https://console.x.ai/)
VITE_XAI_API_KEY=your_xai_api_key_here

# Solana RPC
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_SOLANA_NETWORK=devnet

# Keypair path
SOLANA_KEYPAIR_PATH=~/.config/solana/id.json
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

| Command | Action |
|---------|--------|
| "Create a task to audit the swap program with 0.5 SOL reward" | Create new task |
| "List open tasks" | Show available tasks |
| "Claim task 001" | Claim a task |
| "Complete task 001" | Submit task completion |
| "What's my balance?" | Check SOL balance |
| "Get my address" | Show wallet address |
| "Protocol status" | Show protocol stats |
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
| Planned | Hardware wallet integration (Ledger) |
| Planned | Multi language support |
| Planned | Task marketplace browser |
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
