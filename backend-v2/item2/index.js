exports.handler = async (event, context) => {
  const responseBody = {
    lambdaVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION,
    apiVersion: "v2",
    resource: "item2",
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(responseBody),
  };
};
