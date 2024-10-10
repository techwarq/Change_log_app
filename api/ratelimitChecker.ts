import axios from 'axios';

async function checkRateLimits(accessToken: string) {
  try {
    const response = await axios.get('https://api.github.com/rate_limit', {
      headers: {
        Authorization: `token ${accessToken}`
      }
    });

    const { rate, resources } = response.data;
    console.log('GitHub API Rate Limit Info:');
    console.log(`Core: ${rate.remaining}/${rate.limit} - Reset at ${new Date(rate.reset * 1000)}`);
    console.log(`Search: ${resources.search.remaining}/${resources.search.limit}`);
    console.log(`GraphQL: ${resources.graphql.remaining}/${resources.graphql.limit}`);
    console.log(`Integration Manifest: ${resources.integration_manifest.remaining}/${resources.integration_manifest.limit}`);

    if (rate.remaining < 10) {
      console.warn('Warning: GitHub API rate limit is low!');
    }
  } catch (error) {
    console.error('Error checking rate limits:', error);
  }
}

export default checkRateLimits;