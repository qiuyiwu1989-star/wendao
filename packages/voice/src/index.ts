// @zaowuyun/voice —— 语音交互能力模组
//
// 三层，按需取用：
//   1) 底层原语：startVoiceCapture（录音+静音检测）、createSpeechQueue（句级流式播放）
//   2) 上层编排：useVoiceCall（完整通话状态机：听→识别→你的LLM→说→自动接着听）
//   3) 服务端代理：见 ../server/mimo.ts（ASR/TTS 转发，密钥只在服务端）

export {
  startVoiceCapture,
  recorderSupported,
  type VoiceCapture,
} from "./recorder";

export {
  createSpeechQueue,
  speechSupported,
  takeSentences,
  type SpeechQueue,
} from "./speechQueue";

export {
  useVoiceCall,
  voiceCallSupported,
  type VoiceCall,
  type VoiceCallOptions,
  type CallPhase,
} from "./useVoiceCall";
