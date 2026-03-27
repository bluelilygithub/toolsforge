import { google } from 'googleapis';
import http from 'http';
import url from 'url';
import open from 'open';
import 'dotenv/config';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3002/oauth2callback'
);

const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/analytics.readonly'
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent'
});

console.log('Opening browser for Google authorisation...');

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  if (parsedUrl.pathname === '/oauth2callback') {
    const code = parsedUrl.query.code;
    
    try {
      const { tokens } = await oauth2Client.getToken(code);
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Success! You can close this tab and return to your terminal.</h1>');
      
      console.log('\n✅ Add this to your .env file:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      
      server.close();
    } catch (err) {
      console.error('Error getting tokens:', err);
      res.writeHead(500);
      res.end('Error getting tokens');
      server.close();
    }
  }
});

server.listen(3002, () => {
  open(authUrl);
});