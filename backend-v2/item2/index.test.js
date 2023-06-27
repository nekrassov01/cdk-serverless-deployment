const { handler } = require("./index.js");

describe("Lambda handler", () => {
  beforeEach(() => {
    process.env._HANDLER = "testHandler";
    process.env.AWS_DEFAULT_REGION = "us-east-1";
    process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "functionName";
    process.env.AWS_LAMBDA_FUNCTION_VERSION = "functionVersion";
    process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = "128";
    process.env.AWS_LAMBDA_INITIALIZATION_TYPE = "on-demand";
    process.env.AWS_LAMBDA_LOG_GROUP_NAME = "logGroupName";
    process.env.LAMBDA_TASK_ROOT = "/path/to/taskRoot";
    process.env.LAMBDA_RUNTIME_DIR = "/path/to/runtimeDir";
    process.env.LANG = "en_US.UTF-8";
    process.env.PATH = "/path";
    process.env.NODE_PATH = "/node/path";
    process.env.TZ = "UTC";
  });

  afterEach(() => {
    delete process.env._HANDLER;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_EXECUTION_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
    delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
    delete process.env.AWS_LAMBDA_INITIALIZATION_TYPE;
    delete process.env.AWS_LAMBDA_LOG_GROUP_NAME;
    delete process.env.LAMBDA_TASK_ROOT;
    delete process.env.LAMBDA_RUNTIME_DIR;
    delete process.env.LANG;
    delete process.env.PATH;
    delete process.env.NODE_PATH;
    delete process.env.TZ;
  });

  it("should return a response with statusCode 200", async () => {
    const response = await handler({}, {});
    expect(response.statusCode).toBe(200);
  });

  it("should return a response with Content-Type header set to application/json", async () => {
    const response = await handler({}, {});
    expect(response.headers["Content-Type"]).toBe("application/json");
  });

  it("should return a response body with expected keys", async () => {
    const response = await handler({}, {});
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty("handler");
    expect(body).toHaveProperty("defaultRegion");
    expect(body).toHaveProperty("executionEnv");
    expect(body).toHaveProperty("functionName");
    expect(body).toHaveProperty("functionVersion");
    expect(body).toHaveProperty("memorySize");
    expect(body).toHaveProperty("InitializationType");
    expect(body).toHaveProperty("logGroupName");
    expect(body).toHaveProperty("taskRoot");
    expect(body).toHaveProperty("runtimeDir");
    expect(body).toHaveProperty("lang");
    expect(body).toHaveProperty("path");
    expect(body).toHaveProperty("nodePath");
    expect(body).toHaveProperty("tz");
    expect(body).toHaveProperty("event");
  });

  it("should include the event object in the response body", async () => {
    const mockEvent = { foo: "bar" };
    const response = await handler(mockEvent, {});
    const body = JSON.parse(response.body);
    expect(body.event).toEqual(mockEvent);
  });
});
