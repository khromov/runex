# The Linux image scripts/linux-docker.sh builds and tests runex in: CI's Linux leg as an image.
# Ubuntu 22.04, whose glibc 2.35 the release addon links against; the packages CI installs (Rune's
# libxkbcommon to build, Mesa's lavapipe software Vulkan to render headless); Xvfb and the X11
# libraries a windowed app loads, to run one under `xvfb-run`; the Rust toolchain
# rust-toolchain.toml pins; Node and Bun. Made for ARM64 hosts (Apple Silicon), works on x86_64.
#
# The base image's digest and LAVAPIPE_VERSION are the ones .github/workflows/ci.yml and full.yml
# pin for the canonical golden platform (linux-arm64-lavapipe): the golden pixels are this Mesa's.
# Change all three together (test/static/docker.test.ts checks they agree).
#
#   docker build -t runexlx-linux -f docker/linux-arm64.Dockerfile --build-arg RUST_TOOLCHAIN=1.99.1 docker
FROM ubuntu:22.04@sha256:076e7bf82319619f28dd0aa9c02ab34b055ad37100395b4f49a2ffba04fb5e11

ARG RUST_TOOLCHAIN
ARG LAVAPIPE_VERSION=23.2.1-1ubuntu3.1~22.04.4
ARG NODE_VERSION=24.22.2
ARG BUN_VERSION=1.4.4
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential pkg-config libxkbcommon-dev "mesa-vulkan-drivers=$LAVAPIPE_VERSION" \
      xvfb xauth libxkbcommon-x11-0 libx11-xcb1 libxcursor1 libxi6 libxrandr2 \
      ca-certificates curl git unzip xz-utils \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
RUN test -n "$RUST_TOOLCHAIN" || { echo "pass --build-arg RUST_TOOLCHAIN=<rust-toolchain.toml's channel>"; exit 1; } \
    && curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain "$RUST_TOOLCHAIN" -c clippy,rustfmt \
    && rustc -vV

RUN case "$(dpkg --print-architecture)" in arm64) node=arm64 bun=aarch64 ;; amd64) node=x64 bun=x64 ;; *) exit 1 ;; esac \
    && curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$node.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md \
    && curl -fsSLo /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-$bun.zip" \
    && unzip -j /tmp/bun.zip '*/bun' -d /usr/local/bin && rm /tmp/bun.zip \
    && node --version && bun --version

WORKDIR /work/src
