import { useRef, useState } from "react";

function App() {
  const videoRef = useRef(null);
  const [inputUrl, setInputUrl] = useState("");
  const [videoSrc, setVideoSrc] = useState("");
  const [teraboxUrl, setTeraboxUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const BACKEND = import.meta.env.VITE_BACKEND_URL;

  const playVideo = async () => {
    if (!inputUrl.trim()) return;

    setIsLoading(true);

    try {
      let encodedUrl = encodeURIComponent(inputUrl.trim());

      if (encodedUrl.includes('1024terabox')) {
        const link_id = encodedUrl.replace('https%3A%2F%2F1024terabox.com%2Fs%2F1', '');
        encodedUrl = `https://www.terabox.app/sharing/link?surl=${link_id}`;
      }

      const response = await fetch(`${BACKEND}/test-extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: encodedUrl }),
      });

      const data = await response.json();
      console.log(data);
      setTeraboxUrl(data.directUrl);
      setVideoSrc(`${BACKEND}/google-video?url=${encodedUrl}`);

      setTimeout(() => {
        videoRef.current?.load();
        videoRef.current?.play();
      }, 100);
    } catch (error) {
      console.error("Error fetching video:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const skip = (seconds) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, video.currentTime + seconds);
  };

  return (
    <div style={styles.container}>
      <h2>Terabox Streaming Video Player</h2>

      {/* INPUT */}
      <div style={styles.inputBox}>
        <input
          type="text"
          placeholder="Paste video URL here..."
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          style={styles.input}
          disabled={isLoading}
        />
        <button
          onClick={playVideo}
          style={{
            ...styles.playBtn,
            ...(isLoading ? styles.disabledBtn : {}),
          }}
          disabled={isLoading}
        >
          {isLoading ? "Loading..." : "▶ Play"}
        </button>
      </div>

      {/* LOADING INDICATOR */}
      {isLoading && (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <p>Fetching video data...</p>
        </div>
      )}

      {/* VIDEO LINK */}
      {teraboxUrl && !isLoading && (
        <>
          <a href={teraboxUrl} target="_blank" rel="noopener noreferrer" style={styles.link}>
            Watch Online
          </a>
        </>
      )}
    </div>
  );
}

const styles = {
  container: {
    background: "#111",
    color: "#fff",
    minHeight: "100vh",
    padding: "20px",
    textAlign: "center",
  },
  inputBox: {
    marginBottom: "20px",
  },
  input: {
    width: "500px",
    padding: "10px",
    fontSize: "16px",
    marginRight: "10px",
    borderRadius: "4px",
    border: "1px solid #333",
    background: "#222",
    color: "#fff",
  },
  playBtn: {
    padding: "10px 20px",
    fontSize: "16px",
    cursor: "pointer",
    backgroundColor: "#4CAF50",
    color: "white",
    border: "none",
    borderRadius: "4px",
  },
  disabledBtn: {
    backgroundColor: "#666",
    cursor: "not-allowed",
    opacity: 0.7,
  },
  video: {
    marginTop: "20px",
    borderRadius: "8px",
  },
  controls: {
    marginTop: "15px",
  },
  loadingContainer: {
    marginTop: "30px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
  },
  spinner: {
    width: "40px",
    height: "40px",
    border: "4px solid #f3f3f3",
    borderTop: "4px solid #4CAF50",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  link: {
    display: "inline-block",
    marginTop: "20px",
    padding: "10px 20px",
    backgroundColor: "#2196F3",
    color: "white",
    textDecoration: "none",
    borderRadius: "4px",
  },
};

const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);

export default App;