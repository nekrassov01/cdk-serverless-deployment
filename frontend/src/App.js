import React, { useEffect, useState } from "react";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json";
import { dracula } from "react-syntax-highlighter/dist/esm/styles/hljs";
import "./App.css";
import config from "./config.json";

SyntaxHighlighter.registerLanguage("json", json);

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(
      `https://${process.env.REACT_APP_BACKEND_DOMAIN}/${process.env.REACT_APP_BACKEND_STAGE}/${config.backendVersion}/items/item1`
    )
      .then((res) => res.json())
      .then((data) => setData(data))
      .catch((error) => setError(error.toString()));
  }, []);

  return (
    <div className="dark-container">
      {error && <div>Error: {error}</div>}
      {data && (
        <SyntaxHighlighter language="json" style={dracula}>
          {JSON.stringify(data, null, 2)}
        </SyntaxHighlighter>
      )}
    </div>
  );
}

export default App;
