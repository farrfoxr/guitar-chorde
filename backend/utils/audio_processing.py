import librosa
import numpy as np

def preprocess_audio(file_path, sr=22050, duration=3):
    y, _ = librosa.load(file_path, sr=sr, mono=True)

    target_length = sr * duration
    if len(y) < target_length:
        y = np.pad(y, (0, target_length - len(y)))
    else:
        y = y[:target_length]

    cqt = librosa.cqt(y, sr=sr)
    cqt_db = librosa.amplitude_to_db(np.abs(cqt))
    cqt_db = cqt_db.astype(np.float32)

    # Model expects shape like (freq_bins, time_steps, 1)
    cqt_db = np.expand_dims(cqt_db, axis=-1)
    cqt_db = np.expand_dims(cqt_db, axis=0)  # batch dimension

    return cqt_db
