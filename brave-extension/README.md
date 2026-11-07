# Dawam Bubbles — the extension for Brave

Holds Brave to the bubble Dawam for Windows is running. While a bubble runs,
only its sites open; anything else is swapped for a "not in this bubble" page,
and those tabs go back to their page when the round ends. With no bubble
running, or with Dawam closed, Brave is left alone.

It talks to nothing but Dawam on this computer (`127.0.0.1:47615`), and Dawam
only ever tells it what the bubble is.

## Install

1. In Brave, open `brave://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** and choose `%APPDATA%\Dawam\brave-extension` — Dawam
   copies this folder there on every launch, so the path stays put when Dawam
   is updated. (Bubble settings → *Show the extension folder* opens it.)

Bubble settings in Dawam shows "connected" once Brave is listening.
