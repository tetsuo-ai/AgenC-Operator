//! ============================================================================
//! Local Voice Processor - Whisper-RS ASR & Audio Capture
//! ============================================================================
//! Provides offline voice processing as fallback when Grok API is unavailable:
//! - Wake word detection ("Tetsuo" / "Hey Tetsuo")
//! - Local transcription via whisper-rs
//! - Audio capture via cpal
//! - Audio playback via rodio
//!
//! Primary voice processing goes through Grok Voice API from the frontend.
//! This module provides the local fallback for offline/privacy mode.
//! ============================================================================

use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{info, warn, error, debug};

/// Audio sample rate for whisper (16kHz mono)
const WHISPER_SAMPLE_RATE: u32 = 16000;

/// Buffer size for audio chunks
const AUDIO_BUFFER_SIZE: usize = 4096;

/// Wake phrases that activate Tetsuo
const WAKE_PHRASES: &[&str] = &["tetsuo", "hey tetsuo", "ok tetsuo"];

/// Local voice processor for offline ASR
pub struct LocalVoiceProcessor {
    /// Whether the processor is currently listening
    is_listening: Arc<AtomicBool>,
    /// Path to whisper model file
    model_path: Option<String>,
    /// Audio sample buffer for processing
    sample_buffer: Arc<std::sync::Mutex<Vec<f32>>>,
}

impl LocalVoiceProcessor {
    /// Create new voice processor
    pub fn new() -> Self {
        Self {
            is_listening: Arc::new(AtomicBool::new(false)),
            model_path: None,
            sample_buffer: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    /// Load whisper model for offline transcription
    /// Download from: https://huggingface.co/ggerganov/whisper.cpp
    /// Recommended: ggml-base.en.bin for English, ggml-small.bin for multilingual
    pub async fn load_model(&mut self, model_path: &str) -> Result<()> {
        info!("Loading whisper model from: {}", model_path);

        // Verify model file exists
        if !std::path::Path::new(model_path).exists() {
            return Err(anyhow!(
                "Whisper model not found at: {}. Download from HuggingFace.",
                model_path
            ));
        }

        self.model_path = Some(model_path.to_string());
        info!("Whisper model loaded successfully");

        Ok(())
    }

    /// Get available audio input devices
    pub fn list_audio_devices() -> Result<Vec<String>> {
        let host = cpal::default_host();
        let devices: Vec<String> = host.input_devices()?
            .filter_map(|d| d.name().ok())
            .collect();

        info!("Found {} audio input devices", devices.len());
        Ok(devices)
    }

    /// Start listening for voice input
    /// Returns a channel that receives transcribed text
    pub async fn start_listening(&self) -> Result<mpsc::Receiver<String>> {
        if self.is_listening.load(Ordering::SeqCst) {
            return Err(anyhow!("Already listening"));
        }

        info!("Starting local voice capture...");

        let (tx, rx) = mpsc::channel::<String>(32);
        let is_listening = self.is_listening.clone();
        let sample_buffer = self.sample_buffer.clone();
        let model_path = self.model_path.clone();

        // Spawn audio capture task
        std::thread::spawn(move || {
            if let Err(e) = Self::capture_audio_loop(is_listening, sample_buffer, tx, model_path) {
                error!("Audio capture error: {}", e);
            }
        });

        self.is_listening.store(true, Ordering::SeqCst);
        Ok(rx)
    }

    /// Stop listening
    pub fn stop_listening(&self) {
        info!("Stopping local voice capture");
        self.is_listening.store(false, Ordering::SeqCst);
    }

    /// Check if currently listening
    pub fn is_listening(&self) -> bool {
        self.is_listening.load(Ordering::SeqCst)
    }

    /// Audio capture loop running in separate thread
    fn capture_audio_loop(
        is_listening: Arc<AtomicBool>,
        sample_buffer: Arc<std::sync::Mutex<Vec<f32>>>,
        _tx: mpsc::Sender<String>,
        _model_path: Option<String>,
    ) -> Result<()> {
        let host = cpal::default_host();
        let device = host.default_input_device()
            .ok_or_else(|| anyhow!("No input device found"))?;

        info!("Using audio device: {:?}", device.name());

        // Configure for 16kHz mono (whisper optimal)
        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(WHISPER_SAMPLE_RATE),
            buffer_size: cpal::BufferSize::Fixed(AUDIO_BUFFER_SIZE as u32),
        };

        let sample_buffer_clone = sample_buffer.clone();

        let stream = device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Accumulate samples
                if let Ok(mut buffer) = sample_buffer_clone.lock() {
                    buffer.extend_from_slice(data);

                    // Process every ~2 seconds of audio
                    if buffer.len() >= WHISPER_SAMPLE_RATE as usize * 2 {
                        // Clone data for processing
                        let samples: Vec<f32> = buffer.drain(..).collect();

                        // TODO: Run whisper transcription here
                        // For now, this is a placeholder for the whisper-rs integration
                        debug!("Collected {} samples for transcription", samples.len());
                    }
                }
            },
            move |err| {
                error!("Audio stream error: {}", err);
            },
            None,
        )?;

        stream.play()?;

        // Keep running until stopped
        while is_listening.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        drop(stream);
        info!("Audio stream stopped");

        Ok(())
    }

    /// Transcribe audio samples using whisper-rs
    /// This is the core offline ASR function
    #[allow(dead_code)]
    async fn transcribe_whisper(&self, _samples: &[f32]) -> Result<String> {
        let _model_path = self.model_path.as_ref()
            .ok_or_else(|| anyhow!("Whisper model not loaded"))?;

        // TODO: Full whisper-rs integration
        // Example usage:
        // let ctx = whisper_rs::WhisperContext::new(model_path)?;
        // let mut state = ctx.create_state()?;
        // let mut params = whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy);
        // params.set_language(Some("en"));
        // params.set_print_realtime(false);
        // state.full(params, samples)?;
        // let text = state.get_segment_text(0)?;

        // Placeholder until whisper-rs is fully integrated
        warn!("Whisper transcription not yet implemented - using placeholder");
        Ok(String::new())
    }

    /// Check if text contains wake word
    pub fn contains_wake_word(text: &str) -> bool {
        let lower = text.to_lowercase();
        WAKE_PHRASES.iter().any(|phrase| lower.contains(phrase))
    }

    /// Extract command after wake word
    pub fn extract_command(text: &str) -> Option<String> {
        let lower = text.to_lowercase();

        for phrase in WAKE_PHRASES {
            if let Some(pos) = lower.find(phrase) {
                let after = &text[pos + phrase.len()..];
                let command = after.trim().trim_start_matches(&[',', ':', '-'][..]).trim();
                if !command.is_empty() {
                    return Some(command.to_string());
                }
            }
        }

        None
    }
}

impl Default for LocalVoiceProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// Audio playback for Tetsuo's responses
pub struct AudioPlayback {
    /// Output stream for playback
    _stream: Option<cpal::Stream>,
}

impl AudioPlayback {
    pub fn new() -> Self {
        Self { _stream: None }
    }

    /// Play audio data (PCM f32 samples)
    pub fn play_audio(&mut self, _samples: Vec<f32>, _sample_rate: u32) -> Result<()> {
        // TODO: Implement rodio playback
        // let (_stream, handle) = rodio::OutputStream::try_default()?;
        // let source = rodio::buffer::SamplesBuffer::new(1, sample_rate, samples);
        // handle.play_raw(source)?;

        info!("Audio playback triggered (not yet implemented)");
        Ok(())
    }
}

impl Default for AudioPlayback {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wake_word_detection() {
        assert!(LocalVoiceProcessor::contains_wake_word("Hey Tetsuo, what's the balance?"));
        assert!(LocalVoiceProcessor::contains_wake_word("tetsuo create a task"));
        assert!(!LocalVoiceProcessor::contains_wake_word("hello world"));
    }

    #[test]
    fn test_command_extraction() {
        let cmd = LocalVoiceProcessor::extract_command("Tetsuo, create a task for auditing");
        assert_eq!(cmd, Some("create a task for auditing".to_string()));

        let cmd = LocalVoiceProcessor::extract_command("Hey Tetsuo: list open tasks");
        assert_eq!(cmd, Some("list open tasks".to_string()));
    }
}
