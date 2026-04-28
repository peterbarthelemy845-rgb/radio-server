from flask import Flask, Response, render_template, stream_with_context, url_for
import requests

app = Flask(__name__)

# Your real Icecast stream URL
STREAM_URL = "http://162.244.81.219:8020/live"


@app.route("/")
def home():
    # Use the local /stream proxy so HTTPS pages can play the HTTP Icecast stream.
    return render_template("index.html", stream_url=url_for("stream_proxy"))


@app.route("/stream")
def stream_proxy():
    """Proxy the HTTP Icecast stream through this HTTPS site.

    Browsers often block http:// audio on https:// websites. This route makes
    the audio appear as https://yourdomain.com/stream while the server pulls
    the original Icecast stream in the background.
    """
    upstream = requests.get(
        STREAM_URL,
        stream=True,
        timeout=(5, 30),
        headers={"User-Agent": "LaVoixDivineRadio/1.0"},
    )
    upstream.raise_for_status()

    def generate():
        for chunk in upstream.iter_content(chunk_size=8192):
            if chunk:
                yield chunk

    return Response(
        stream_with_context(generate()),
        content_type=upstream.headers.get("Content-Type", "audio/mpeg"),
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.route("/health")
def health():
    return "ok", 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
