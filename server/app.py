"""YouTube -> WAV converter for Yamaha PSR-E473.
Output spec: 44.1 kHz, 16-bit, stereo PCM, ASCII filename.
"""
from flask import Flask, render_template, request, send_file, jsonify, after_this_request
import subprocess
import tempfile
import re
import uuid
from pathlib import Path

app = Flask(__name__)
OUT = Path(tempfile.gettempdir()) / "yamaha_psr_wav"
OUT.mkdir(exist_ok=True)


def safe_name(title: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]", "", title)[:16].upper()
    return cleaned or "SONG"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/convert", methods=["POST"])
def convert():
    url = (request.form.get("url") or "").strip()
    if not url:
        return jsonify(error="URL required"), 400

    job = uuid.uuid4().hex[:8]
    raw = OUT / f"raw_{job}"

    try:
        title = subprocess.check_output(
            ["yt-dlp", "--no-playlist", "--get-title", url],
            text=True, timeout=60,
        ).strip()
    except subprocess.CalledProcessError as e:
        return jsonify(error=f"yt-dlp title fetch failed: {e}"), 500
    except FileNotFoundError:
        return jsonify(error="yt-dlp not installed. Run: pip install yt-dlp"), 500
    except subprocess.TimeoutExpired:
        return jsonify(error="yt-dlp timeout fetching title"), 500

    name = safe_name(title)
    wav = OUT / f"{name}_{job}.WAV"

    dl = subprocess.run(
        ["yt-dlp", "--no-playlist", "-f", "bestaudio",
         "-o", str(raw) + ".%(ext)s", url],
        capture_output=True, text=True,
    )
    if dl.returncode != 0:
        return jsonify(error=f"download failed: {dl.stderr[-500:]}"), 500

    raw_files = list(OUT.glob(f"raw_{job}.*"))
    if not raw_files:
        return jsonify(error="downloaded file not found"), 500
    raw_file = raw_files[0]

    ff = subprocess.run(
        ["ffmpeg", "-y", "-i", str(raw_file),
         "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le",
         "-f", "wav", str(wav)],
        capture_output=True, text=True,
    )
    raw_file.unlink(missing_ok=True)
    if ff.returncode != 0:
        wav.unlink(missing_ok=True)
        return jsonify(error=f"ffmpeg failed: {ff.stderr[-500:]}"), 500

    @after_this_request
    def cleanup(response):
        try:
            wav.unlink(missing_ok=True)
        except Exception:
            pass
        return response

    return send_file(
        wav,
        as_attachment=True,
        download_name=f"{name}.WAV",
        mimetype="audio/wav",
    )


if __name__ == "__main__":
    app.run(debug=True, port=5000)
