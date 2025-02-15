require("dotenv").config()
const axios = require('axios');
const Groq = require('groq-sdk');
const express = require('express')
const cors = require("cors")
const verifyURL = require("./verifyUrl")
const app = express()
const port = process.env.PORT || 3000
app.use(express.json())
app.use(cors())

// const client = new Groq({
//   apiKey: process.env.GROQ_API_KEY, // This is the default and can be omitted
// });

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.post('/getChannelData', async (req, res) => {
  let videos = [];
  let nextPageToken = "";
  do {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${req.body.channelId}&maxResults=50&type=video&pageToken=${nextPageToken}&key=${process.env.YOUTUBE_API_KEY}`;
    const response = await axios.get(url);
    
    response.data.items.forEach(video => {
      videos.push({
        title: video.snippet.title,
        videoId: video.id.videoId
      });
    });

    nextPageToken = response.data.nextPageToken || "";
  } while (nextPageToken);

  res.send(videos)
})

app.post('/getChannelId', async (req, res) => {
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${req.body.CHANNEL_HANDLE}&type=channel&key=${process.env.YOUTUBE_API_KEY}`;
  const searchResponse = await axios.get(searchUrl);
  
  if (searchResponse.data.items.length === 0) {
    return res.send({success: false, msg: "Channel not found"})
  }

  res.send({success: true, msg: searchResponse.data.items[0].id.channelId})
})

app.post('/getContentAnalysis', async (req, res) => {
  let comments = await getComments(req.body.videoId);
  executeCommentAnalysis(comments.map((c,i)=>`${i+1}. ${c.text}`).join("\n"))
  res.send(comments)
})

app.post('/verifyContentUrl', async (req, res) => {
  try {
    var url = new URL(req.body.url);
    res.send(await verifyURL(req.body.url))
  } catch (err) {
    res.send({success: false, msg: "Invalid URL"})
  }
})

app.post('/getVideoComments', async (req, res) => {
  res.send((await getComments(req.body.videoId)).map((c,i)=>`${i+1}. ${c.text}`).join("\n"))
})

app.listen(port, () => {
  console.log(`App listening on port ${port}`)
})

function decodeCommentAnalysis(comments, analysis) {
  const wordToCode = ["very negative", "negative", "neutral", "positive", "very positive"]
  analysis = analysis.split("\n").filter(l=>l!==undefined&&l!="").map(l=>wordToCode.indexOf(l.split(". ")[1])+1)
  return {
    stats: analysis.reduce(function (acc, curr) {
      return acc[curr] ? ++acc[curr] : acc[curr] = 1, acc
    }, {}),
    comments: comments.map((c,i)=>{return {...c, rating: analysis[i]}})
  }
}

const executeCommentAnalysis = async (video_details, comments) => {
  const chatCompletion = await client.chat.completions.create({
    messages: [{ role: 'user', content: 'Explain the importance of low latency LLMs' }],
    model: 'llama-3.1-8b-instant',
  });

  decodeCommentAnalysis(comments, chatCompletion.choices[0].message.content)
}

const getComments = async (videoId) => {
  let comments = [];
  let nextPageToken = "";
  
  do {
    const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=50&pageToken=${nextPageToken}&key=${process.env.YOUTUBE_API_KEY}`;
    const response = await axios.get(url);

    response.data.items.forEach(comment => {
      comments.push({
        author: comment.snippet.topLevelComment.snippet.authorDisplayName,
        text: comment.snippet.topLevelComment.snippet.textDisplay,
        publishedAt: comment.snippet.topLevelComment.snippet.publishedAt
      });
    });

    nextPageToken = response.data.nextPageToken || "";
  } while (nextPageToken);

  // Unique comments
  comments = [...new Map(comments.map(item => [item['text'], item])).values()]
  
  return comments;
}
