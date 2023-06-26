import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";

test("renders data from API", async () => {
  const mockResponse = {
    handler: "",
    defaultRegion: "",
    executionEnv: "",
    functionName: "",
    functionVersion: "",
    memorySize: "",
    InitializationType: "",
    logGroupName: "",
    taskRoot: "",
    runtimeDir: "",
    lang: "",
    path: "",
    nodePath: "",
    tz: "",
    event: {},
  };

  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve(mockResponse),
    })
  );

  render(<App />);

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

  await screen.findByText(/handler/);
  await screen.findByText(/defaultRegion/);
  await screen.findByText(/executionEnv/);
  await screen.findByText(/functionName/);
  await screen.findByText(/functionVersion/);
  await screen.findByText(/memorySize/);
  await screen.findByText(/InitializationType/);
  await screen.findByText(/logGroupName/);
  await screen.findByText(/runtimeDir/);
  await screen.findByText(/lang/);
  await screen.findByText(/path/);
  await screen.findByText(/nodePath/);
  await screen.findByText(/tz/);
  await screen.findByText(/event/);

  jest.clearAllMocks();
});
