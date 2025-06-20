import React, { useState, useRef } from 'react';
import { Mic, MicOff, Guitar } from 'lucide-react';

const GuitarChordDetector = () => {
  // ── API CONFIGURATION ───────────────────────────────────────────────────────
  const API_BASE_URL = 'http://127.0.0.1:5000';
  const API_ENDPOINT = '/predict';

  // ── STATE & REFS ────────────────────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const [currentChord, setCurrentChord] = useState('');
  const [volume, setVolume] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Click to start listening');
  const [error, setError] = useState('');

  // Audio‐related refs:
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const microphoneRef = useRef(null);
  const audioStreamRef = useRef(null);
  const animationRef = useRef(null);
  const monitoringRef = useRef(false);

  const VOLUME_THRESHOLD = 0.02;     // RMS threshold to trigger recording
  const RECORDING_DURATION = 3000;   // Record 3 seconds per chunk

  // ── GUITAR ICON (inline SVG) ───────────────────────────────────────────────
  const GuitarIcon = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      <path d="M19.07 4.93l-1.41 1.41C20.05 7.74 20.91 9.79 20.91 12s-.86 4.26-2.25 5.66l1.41 1.41C21.36 17.78 22.41 14.96 22.41 12s-1.05-5.78-2.34-7.07zM17.66 6.34l-1.41 1.41C16.74 8.24 17.09 10.09 17.09 12s-.35 3.76-.84 4.25l1.41 1.41C18.16 17.16 18.59 14.64 18.59 12s-.43-5.16-.93-5.66z"/>
    </svg>
  );

  // ── 1) INITIALIZE AUDIO (one‐time getUserMedia) ─────────────────────────────
  const initializeAudio = async () => {
    try {
      // Ask permission and grab a single MediaStream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      // Create AudioContext + analyser node once
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      microphoneRef.current = audioContextRef.current.createMediaStreamSource(stream);

      analyserRef.current.fftSize = 256;
      microphoneRef.current.connect(analyserRef.current);

      return true;
    } catch (err) {
      setError('Microphone access denied. Please allow microphone permissions.');
      return false;
    }
  };

  // ── HELPER: CALCULATE RMS OF FLOAT32ARRAY ────────────────────────────────────
  const calculateRMS = (buffer) => {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  };

  // ── 2) MONITOR AUDIO CONTINUOUSLY FOR VOLUME SPIKES ───────────────────────────
  const monitorAudio = () => {
    if (!analyserRef.current || monitoringRef.current) return;
    monitoringRef.current = true;

    const bufferLength = analyserRef.current.fftSize / 2;
    const dataArray = new Float32Array(bufferLength);

    const checkVolume = () => {
      analyserRef.current.getFloatFrequencyData(dataArray);
      const rms = calculateRMS(dataArray);
      const normalizedVolume = Math.max(0, Math.min(1, (rms + 100) / 100));

      setVolume(normalizedVolume);

      // If we exceed threshold and are not already recording, trigger a new recording cycle
      if (normalizedVolume > VOLUME_THRESHOLD && !isRecording) {
        monitoringRef.current = false;
        startRecording();
        return;
      }

      // Otherwise, keep checking as long as isListening is true
      if (isListening) {
        animationRef.current = requestAnimationFrame(checkVolume);
      } else {
        monitoringRef.current = false;
      }
    };

    checkVolume();
  };

  // ── 3) START RECORDING (reuse the same audioStreamRef) ─────────────────────────
  const startRecording = async () => {
    if (isRecording) return;

    setIsRecording(true);
    setStatus('Recording chord...');

    try {
      // Reuse the same stream we created in initializeAudio
      const mediaRecorder = new MediaRecorder(audioStreamRef.current);
      const chunks = [];

      mediaRecorder.ondataavailable = (event) => chunks.push(event.data);

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/wav' });
        await sendAudioToAPI(blob);
        // Do NOT stop the main stream here—keep listening for next chord
      };

      mediaRecorder.start();
      // After RECORDING_DURATION, stop the recorder
      setTimeout(() => {
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      }, RECORDING_DURATION);
    } catch (err) {
      setError('Failed to start recording');
      setIsRecording(false);
      setStatus('Listening for chords...');
      monitorAudio(); // Immediately resume listening if something went wrong
    }
  };

  // ── 4) SEND AUDIO BLOB TO YOUR FLASK API ──────────────────────────────────────
  const sendAudioToAPI = async (audioBlob) => {
    try {
      setStatus('Analyzing chord...');
      setError('');

      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.wav');

      const response = await fetch(`${API_BASE_URL}${API_ENDPOINT}`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (response.ok) {
        setCurrentChord(result.prediction);
        setStatus('Chord detected! Ready for next...');
      } else {
        setError(result.error || 'Failed to analyze audio');
        setStatus('Analysis failed – listening continues...');
      }
    } catch (err) {
      setError('Failed to connect to server');
      setStatus('Connection failed – listening continues...');
    } finally {
      setIsRecording(false);
      // As soon as one prediction is done, immediately resume monitoring
      if (isListening) {
        monitorAudio();
      }
    }
  };

  // ── 5) TOGGLE THE MIC BUTTON ─────────────────────────────────────────────────
  const toggleListening = async () => {
    if (!isListening) {
      // Starting to listen: initialize audio and begin monitoring loop
      const success = await initializeAudio();
      if (success) {
        setIsListening(true);
        setStatus('Listening for chords...');
        setError('');
        monitorAudio();
      }
    } else {
      // Stopping: cancel any monitoring loop + close audio context + stop streams
      setIsListening(false);
      setStatus('Click to start listening');
      monitoringRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      setVolume(0);
    }
  };

  // ── HELPER: COLOR FOR VOLUME BAR ─────────────────────────────────────────────
  const getVolumeColor = () => {
    return volume > VOLUME_THRESHOLD ? 'bg-green-400' : 'bg-gray-300';
  };

  // ── COMPONENT JSX ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto">
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <Guitar className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-light text-gray-800 mb-2">Chord Detector</h1>
          <p className="text-gray-500 font-light">Strum a chord to detect it</p>
        </div>

        {/* ── CURRENT CHORD DISPLAY ───────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-lg p-8 mb-6 border border-gray-100">
          <div className="text-center">
            {currentChord ? (
              <div className="animate-fade-in">
                <p className="text-sm text-gray-500 mb-2 font-light">Detected Chord</p>
                <p className="text-5xl font-light text-green-600 mb-2">
                  {currentChord}
                </p>
              </div>
            ) : (
              <div className="py-8">
                <Guitar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-400 font-light">No chord detected</p>
              </div>
            )}
          </div>
        </div>

        {/* ── VOLUME INDICATOR ───────────────────────────────────────────────── */}
        {isListening && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500 font-light">Audio Level</span>
              <span className="text-xs text-gray-400">
                {volume > VOLUME_THRESHOLD ? 'Recording ready' : 'Play louder'}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-100 ${getVolumeColor()}`}
                style={{ width: `${Math.min(volume * 100, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* ── MIC TOGGLE BUTTON ──────────────────────────────────────────────── */}
        <div className="text-center mb-6">
          <button
            onClick={toggleListening}
            disabled={isRecording}
            className={`
              inline-flex items-center justify-center w-20 h-20 rounded-full
              transition-all duration-200 transform hover:scale-105 active:scale-95
              ${isListening
                ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg'
                : 'bg-white hover:bg-gray-50 text-gray-600 shadow-md border-2 border-gray-200'
              }
              ${isRecording ? 'animate-pulse' : ''}
              disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
            `}
          >
            {isListening ? (
              <MicOff className="w-8 h-8" />
            ) : (
              <Mic className="w-8 h-8" />
            )}
          </button>
        </div>

        {/* ── STATUS & ERRORS ────────────────────────────────────────────────── */}
        <div className="text-center mb-4">
          <p
            className={`text-sm font-light ${
              error
                ? 'text-red-500'
                : isRecording
                ? 'text-green-600'
                : isListening
                ? 'text-blue-600'
                : 'text-gray-500'
            }`}
          >
            {error || status}
          </p>
          {error && isListening && (
            <p className="text-xs text-gray-400 mt-1">
              Still listening for new chords...
            </p>
          )}
        </div>

        {/* ── RECORDING INDICATOR ─────────────────────────────────────────────── */}
        {isRecording && (
          <div className="text-center">
            <div className="inline-flex items-center space-x-2 text-green-600">
              <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
              <span className="text-sm font-light">Recording...</span>
              <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
            </div>
          </div>
        )}
      </div>

      {/* ── FADE‐IN ANIMATION STYLES ─────────────────────────────────────────── */}
      <style jsx>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default GuitarChordDetector;
