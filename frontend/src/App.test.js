import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";

test("renders data from API", async () => {
  const mockResponse = {
    lambdaVersion: "5",
    apiVersion: "v1",
    resource: "item1",
  };
  global.fetch = jest.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve(mockResponse),
    })
  );

  render(<App />);

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

  await screen.findByText(/lambdaVersion/);
  await screen.findByText(/apiVersion/);
  await screen.findByText(/resource/);

  // モックをクリア
  jest.clearAllMocks();
});
