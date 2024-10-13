// publicrepo.ts
import { Router, Request, Response } from 'express';
import { repositories } from './const';

const router = Router();

router.get('/repos', async (req: Request, res: Response) => {
  console.log('Received request for repos:', req.params, req.query);
  
  // Map the repositories to a clickable HTML list
  const repoList = repositories
    .map(repo => `<li><a href="${repo.url}" target="_blank">${repo.name}</a></li>`)
    .join('');

  // Send the HTML response
  res.send(`
    <html>
      <body>
        <h1>Public Repositories</h1>
        <ul>
          ${repoList}
        </ul>
      </body>
    </html>
  `);
});

export default router;
