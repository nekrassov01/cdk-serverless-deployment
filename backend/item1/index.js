exports.handler = async (event, context) => {
  console.log("test");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handler: process.env._HANDLER,
      defaultRegion: process.env.AWS_DEFAULT_REGION,
      executionEnv: process.env.AWS_EXECUTION_ENV,
      functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
      functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION,
      memorySize: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
      InitializationType: process.env.AWS_LAMBDA_INITIALIZATION_TYPE,
      logGroupName: process.env.AWS_LAMBDA_LOG_GROUP_NAME,
      taskRoot: process.env.LAMBDA_TASK_ROOT,
      runtimeDir: process.env.LAMBDA_RUNTIME_DIR,
      lang: process.env.LANG,
      path: process.env.PATH,
      nodePath: process.env.NODE_PATH,
      tz: process.env.TZ,
      event: event,
    }),
  };
};
