from flask import Flask, request, jsonify
import tensorflow as tf
import numpy as np
import os
import pickle
from utils.audio_processing import preprocess_audio
from flask_cors import CORS



app = Flask(__name__)
CORS(app)

# Load model and label encoder
MODEL_PATH = "model/guitar_chord_model.h5"
ENCODER_PATH = "model/label_encoder.pkl"

model = tf.keras.models.load_model(MODEL_PATH)

with open(ENCODER_PATH, "rb") as f:
    le = pickle.load(f)

@app.route("/predict", methods=["POST"])
def predict():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files["file"]

    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    # Save temporarily
    temp_path = "temp.wav"
    file.save(temp_path)

    try:
        features = preprocess_audio(temp_path)
        preds = model.predict(features)
        top_pred = np.argmax(preds, axis=1)[0]
        chord = le.inverse_transform([top_pred])[0]
        return jsonify({"prediction": chord})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.remove(temp_path)

if __name__ == "__main__":
    app.run(debug=True)
