#!/bin/zsh
export ANDROID_HOME=/Users/pchmirenko/Library/Android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/28.0.13004108
export ANDROID_NDK=$NDK_HOME
export ANDROID_NDK_HOME=$NDK_HOME
export JAVA_HOME=/opt/homebrew/opt/openjdk@21

NDK_BIN=$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin
NDK_TOOLS=/Users/pchmirenko/.local/ndk-tools

export PATH="$NDK_TOOLS:$NDK_BIN:$JAVA_HOME/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/pchmirenko/.cargo/bin:/Users/pchmirenko/.bun/bin"

export AR_aarch64_linux_android="$NDK_BIN/llvm-ar"
export RANLIB_aarch64_linux_android="$NDK_BIN/llvm-ranlib"
export CC_aarch64_linux_android="$NDK_BIN/aarch64-linux-android24-clang"
export CXX_aarch64_linux_android="$NDK_BIN/aarch64-linux-android24-clang++"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_BIN/aarch64-linux-android24-clang"

cd /Users/pchmirenko/Desktop/AgenC-Operator
npx tauri android build --target aarch64
