/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_VOICE_PROMPT_BYTES,
  VOICE_PROMPT_DEFINITIONS,
  decodeVoicePromptUpload,
  looksLikeMp3,
  normalizeVoicePromptKey,
  voicePromptStoragePath,
} = require("./supportVoicePrompts");

test("voice prompts expose every supported call phase", () => {
  assert.deepEqual(Object.keys(VOICE_PROMPT_DEFINITIONS), [
    "recording_notice",
    "hold_waiting",
    "staff_screen",
    "connecting",
    "callback_offer",
    "callback_confirmed",
    "voicemail_greeting",
    "voicemail_confirmed",
  ]);
  assert.equal(normalizeVoicePromptKey(" CALLBACK_OFFER "), "callback_offer");
  assert.equal(voicePromptStoragePath("callback_offer"), "support-voice-prompts/callback_offer.mp3");
  assert.throws(() => normalizeVoicePromptKey("unknown"), /supported voice prompt/);
});

test("voice prompt uploads validate MP3 content instead of trusting the file name", () => {
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
  assert.equal(looksLikeMp3(mp3), true);
  const upload = decodeVoicePromptUpload({
    promptKey: "voicemail_greeting",
    fileName: "greeting.mp3",
    contentType: "audio/mpeg",
    dataBase64: mp3.toString("base64"),
  });
  assert.equal(upload.contentType, "audio/mpeg");
  assert.deepEqual(upload.buffer, mp3);
  assert.throws(() => decodeVoicePromptUpload({
    promptKey: "voicemail_greeting",
    fileName: "greeting.mp3",
    contentType: "audio/mpeg",
    dataBase64: Buffer.from("not an mp3").toString("base64"),
  }), /valid MP3/);
  assert.throws(() => decodeVoicePromptUpload({
    promptKey: "voicemail_greeting",
    fileName: "greeting.wav",
    contentType: "audio/wav",
    dataBase64: mp3.toString("base64"),
  }), /\.mp3/);
});

test("voice prompt uploads reject files above the size limit", () => {
  const oversized = Buffer.alloc(MAX_VOICE_PROMPT_BYTES + 1, 0);
  oversized.set(Buffer.from("ID3"));
  assert.throws(() => decodeVoicePromptUpload({
    promptKey: "connecting",
    fileName: "connecting.mp3",
    contentType: "audio/mpeg",
    dataBase64: oversized.toString("base64"),
  }), /8 MB or smaller/);
});
