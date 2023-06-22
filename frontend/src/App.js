import React, { useEffect, useState } from "react";
import config from "./config.json";

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
      <pre className="dark-code-block">
        <code>{JSON.stringify(data, null, 2)}</code>
      </pre>
    </div>
  );
}

export default App;
