export function handleWebSocketError(ws, error, context) {
  console.error(`WebSocket error in ${context}:`, error);
  
  try {
    ws.send(JSON.stringify({
      t: 'error',
      error: 'internal_error',
      message: 'An error occurred'
    }));
  } catch (sendError) {
    console.error('Failed to send error message:', sendError);
  }
}

export function createSafeWebSocketHandler(handler) {
  return async (ws, msg) => {
    try {
      await handler(ws, msg);
    } catch (error) {
      handleWebSocketError(ws, error, 'message_handler');
    }
  };
}