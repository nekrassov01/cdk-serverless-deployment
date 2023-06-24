exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lambdaVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION,
      apiVersion: "v1",
      resource: "items/item2",
    }),
  };
};
