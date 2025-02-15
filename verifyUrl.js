const axios = require('axios');

// Function to extract video ID from a YouTube URL
function extractYouTubeVideoId(url) {
  const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
  return match ? match[1] : null;
}

// Function to extract tweet ID from a Twitter URL
function extractTweetId(url) {
  const match = url.match(/twitter\.com\/.*\/status\/(\d+)/);
  return match ? match[1] : null;
}

// Check if a YouTube video exists
async function checkYouTube(videoId) {
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=id&id=${videoId}&key=${process.env.YOUTUBE_API_KEY}`;
    const response = await axios.get(url);
    return response.data.items.length > 0;
  } catch (error) {
    console.error("YouTube API Error:", error.response?.data || error.message);
    return false;
  }
}

// Check if a tweet exists
async function checkTwitter(tweetId) {
  try {
    const url = `https://api.twitter.com/2/tweets/${tweetId}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` },
    });
    return response.status === 200;
  } catch (error) {
    console.error("Twitter API Error:", error.response?.data || error.message);
    return false;
  }
}

// Main function to check if a given URL is valid
module.exports =  async function verifyURL(url) {
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    const videoId = extractYouTubeVideoId(url);
    if (videoId) {
      const exists = await checkYouTube(videoId);
      return {success: exists, msg: `YouTube Video ${exists ? "exists" : "does NOT exist"}`};
    } else {
        return {success: false, msg: `Invalid YouTube URL`};
    }
  } else if (url.includes("twitter.com")) {
    const tweetId = extractTweetId(url);
    if (tweetId) {
      const exists = await checkTwitter(tweetId);
      return {success: exists, msg: `Tweet ${exists ? "exists" : "does NOT exist"}`};
    } else {
        return {success: false, msg: `Invalid Twitter URL`};
    }
  } else {
    return {success: true, msg: `URL is neither a YouTube nor a Twitter link `};
  }
}
