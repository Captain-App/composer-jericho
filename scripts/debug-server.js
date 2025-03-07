const http = require('http');

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    
    req.on('end', () => {
      try {
        const logData = JSON.parse(data);
        // Format and print the log data
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${logData.level}: ${logData.message}`);
        if (logData.error) {
          console.error(logData.error);
        }
      } catch (err) {
        console.log('Raw log data:', data);
      }
      
      res.writeHead(200);
      res.end('OK');
    });
  } else {
    res.writeHead(405);
    res.end('Method not allowed');
  }
});

const PORT = process.env.DEBUG_PORT || 7777;
server.listen(PORT, () => {
  console.log(`Debug server listening on port ${PORT}`);
}); 