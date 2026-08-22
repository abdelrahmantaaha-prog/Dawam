// Chair detection: samples the webcam every 2.5s and reports whether a face
// is visible. Runs ONLY while a work session is active (main.js manages the
// window). Everything is local — frames never leave this process.
import {
  FilesetResolver,
  FaceDetector
} from '../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

(async () => {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      '../../node_modules/@mediapipe/tasks-vision/wasm'
    );
    const detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: '../../assets/models/blaze_face_short_range.tflite'
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.4
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240 },
      audio: false
    });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    setInterval(() => {
      try {
        if (video.readyState < 2) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const result = detector.detect(canvas);
        window.rhythmFocus.presenceReport(result.detections.length > 0);
      } catch {}
    }, 2500);
  } catch (err) {
    console.error('presence init failed:', err && err.message);
    // Send the error name so main can tell "camera busy" (retry later)
    // from "permission denied / no camera" (give up).
    window.rhythmFocus.presenceReport({ error: (err && err.name) || 'unknown' });
  }
})();
