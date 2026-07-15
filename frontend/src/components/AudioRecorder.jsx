import { useEffect, useRef, useState } from 'react';

// browsers disagree on which codecs MediaRecorder supports, so we check a
// list in priority order and let the browser tell us what it can actually do
// instead of hardcoding one format that might not work everywhere (webm is
// chrome/firefox, mp4 is what safari/ios actually supports)
const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return CANDIDATE_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function extensionFor(mimeType) {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

// record straight from the mic instead of making people record separately
// and upload a file. handles the two big cross-platform gotchas: the user
// saying no to the mic permission prompt, and the browser killing the mic
// stream if they background the tab or lock their phone mid-recording
export default function AudioRecorder({ onRecordingReady }) {
  // idle | requesting | recording | stopped | denied | unsupported | error
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  // always let go of the mic when this component goes away, otherwise the
  // browser's "mic is in use" indicator stays on even after you navigate off
  useEffect(() => {
    return () => {
      releaseStream();
      clearInterval(timerRef.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // if the tab gets backgrounded or the phone screen locks while we're
  // recording, ios/android will suspend the mic stream. rather than just
  // losing the recording silently, stop and save whatever got captured
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && recorderRef.current?.state === 'recording') {
        stopRecording("recording stopped because you left the tab -- here's what got captured");
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function startRecording() {
    setMessage('');
    setNote('');

    // getUserMedia only exists on https (or localhost) and in browsers that
    // actually implement it -- fail with a clear message instead of a
    // confusing crash
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('unsupported');
      setMessage("this browser (or connection) doesn't support in-browser recording -- needs https, and a modern browser. upload a file instead.");
      return;
    }

    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        releaseStream();
        clearInterval(timerRef.current);

        const finalMimeType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: finalMimeType });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setStatus('stopped');

        const file = new File([blob], `recording-${Date.now()}.${extensionFor(finalMimeType)}`, { type: finalMimeType });
        onRecordingReady(file);
      };

      // a device disconnect or encoder failure mid-recording fires this instead
      // of onstop -- without releasing the stream here, the mic stays "in use"
      // (browser indicator stays lit) with no way back to idle in the UI
      recorder.onerror = (e) => {
        releaseStream();
        clearInterval(timerRef.current);
        setStatus('error');
        setMessage(e.error?.message || 'recording stopped unexpectedly. try again.');
      };

      recorder.start();
      setStatus('recording');
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      releaseStream();
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        setStatus('denied');
        setMessage("mic access is blocked. allow microphone access for this site in your browser's settings, then try again.");
      } else if (err.name === 'NotFoundError') {
        setStatus('error');
        setMessage("couldn't find a microphone on this device.");
      } else {
        setStatus('error');
        setMessage(err.message || 'something went wrong starting the recording.');
      }
    }
  }

  function stopRecording(autoStopNote) {
    if (autoStopNote) setNote(autoStopNote);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }

  function reRecord() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setStatus('idle');
    setSeconds(0);
    setNote('');
    onRecordingReady(null);
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="recorder">
      {(status === 'denied' || status === 'error' || status === 'unsupported') && (
        <p className="form-error">{message}</p>
      )}
      {note && <p className="recorder-note">{note}</p>}

      {(status === 'idle' || status === 'denied' || status === 'error') && (
        <button type="button" className="record-button" onClick={startRecording}>
          <span className="record-button-icon">🎙️</span>
          <span className="record-button-label">record</span>
        </button>
      )}

      {status === 'requesting' && <p className="recorder-note">waiting on mic permission...</p>}

      {status === 'recording' && (
        <div className="recorder-active">
          <span className="recorder-dot" />
          <span className="recorder-timer">{mm}:{ss}</span>
          <button type="button" className="btn btn-danger btn-small" onClick={() => stopRecording()}>
            stop
          </button>
        </div>
      )}

      {status === 'stopped' && previewUrl && (
        <div className="recorder-preview">
          <audio controls src={previewUrl} />
          <button type="button" className="btn btn-secondary btn-small" onClick={reRecord}>
            record again
          </button>
        </div>
      )}
    </div>
  );
}
