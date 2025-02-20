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

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY, // This is the default and can be omitted
});

const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
});

app.get('/', (req, res) => {
    res.send('Hello World!')
})

const getChannelData = async (curl) => {
  let channelId = await getChannelId(curl);
  let videos = [];
  let nextPageToken = "";

  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=15&type=video&pageToken=${nextPageToken}&key=${process.env.YOUTUBE_API_KEY}&order=date`;
  const response = await axios.get(url);

  response.data.items.forEach(video => {
    videos.push({
      title: video.snippet.title,
      videoId: video.id.videoId,
      thumbnail: video.snippet.thumbnails.high.url,
      videoUrl: `https://www.youtube.com/watch?v=${video.id.videoId}` 
    });
  });

  return videos;
}

app.post('/getChannelData', async (req, res) => {
  res.send(await getChannelData(req.body.url))
});


app.post('/getChannelId', async (req, res) => {
  let channelId = await getChannelId(req.body.url)
  res.send({success: !!channelId.length, msg: channelId})
})

const getChannelId = async (url) => {
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${url.split("@")[1].split("/")[0]}&type=channel&key=${process.env.YOUTUBE_API_KEY}`;
  const searchResponse = await axios.get(searchUrl);
  
  if (searchResponse.data.items.length === 0) {
    return ""
  }
  return searchResponse.data.items[0].id.channelId
}

app.post('/getContentAnalysis', async (req, res) => {
  try {
    var url = new URL(req.body.url)
    const videoId = url.searchParams.get('v')
    let videoDetails = await getVideoDetails(videoId)
    let comments = await getComments(videoId);
    res.send(await executeCommentAnalysis2(videoDetails, comments))
  } catch (err) {
    res.send({success: false, msg: "Invalid URL"})
  }
  
})

app.post('/getChannelAnalysis', async (req, res) => {
  let videos = await getChannelData(req.body.url);
  res.send({
    "stats": {
      "1": 0,
      "2": 2,
      "3": 2,
      "4": 9,
      "5": 133
    },
    videos: videos
  })
});

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

app.post('/chat', async (req, res) => {
  try {
      const url = new URL(req.body.url);
      const videoId = url.searchParams.get('v');
      // Fetch and format YouTube comments
      let comments = (await getComments(videoId))
          .map((c, i) => `${i + 1}. ${c.text}`)
          .join("\n");

      // Define generation settings
      const generationConfig = {
          temperature: 1,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
          responseMimeType: "text/plain",
      };

      console.log(req.body.history);

      // Ensure first message is from 'user' with correct format
      let history = req.body.history || [];
      history.unshift({
          role: "user",
          parts: [{ text: `You are an assistant that helps analyze YouTube comments. Here are the comments:\n\n${comments}` }]
      });

      // Convert history messages to correct format (ensuring 'parts' is an array)
      history = history.map(msg => ({
          role: msg.role,
          parts: Array.isArray(msg.parts) ? msg.parts : [{ text: msg.content }]
      }));

      // Start chat session
      const chatSession = model.startChat({ generationConfig, history });

      // Send user's latest message
      const result = await chatSession.sendMessage(req.body.newInput);

      console.log(result.response.text());
      res.send({ content: result.response.text() });

  } catch (error) {
      console.error("Error in chat processing:", error);
      res.status(500).send({ error: "Something went wrong" });
  }
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`)
})

function decodeCommentAnalysis(comments, analysis) {
  const wordToCode = ["very negative", "negative", "neutral", "positive", "very positive"];
  
  analysis = analysis.split(",")
    .filter(l => l !== undefined && l !== "")
    .map(l => wordToCode.indexOf(l) + 1);

  let stats = analysis.reduce((acc, curr) => {
    let key = curr.toString(); // Ensure keys are strings
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Ensure all ratings from "1" to "5" exist in stats
  for (let i = 1; i <= 5; i++) {
    let key = i.toString();
    if (!(key in stats)) {
      stats[key] = 0;
    }
  }

  return {
    stats,
    comments: comments.map((c, i) => ({ ...c, rating: analysis[i] })),
  };
}


const chunkArray = (comments, maxChars = 10000) => {
  let chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (let comment of comments) {
    if (currentLength + comment.length > maxChars) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }
    currentChunk.push(comment);
    currentLength += comment.length;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
};

const executeCommentAnalysis = async (video_details, comments) => {
  let results = [];

  let commentChunks = chunkArray(comments.map(c=>c.text));
  console.log(commentChunks.length)
  var initLimit = commentChunks[0].length
  commentChunks = commentChunks.map(ch=>ch.map((c,i)=>`${i+1}. ${c}`).join("\n"))
  
  var i = 0;
  for (const chunk of commentChunks) {
  //   console.log(`Perform sentiment analysis on the following comments of a youtube video posted by "${video_details.channelTitle}" with title "${video_details.title}" and classify it as one of the given labels: the text is hindi written as english, is given in individual numerical points. the output should only contain the bullet point number a full stop then label and nothing else. ignore the youtube links and html tags.
  // Labels: very negative, negative, neutral, positive, very positive
  // comments:
  // ${chunk}`)
    console.log("Chunk started")
    const chatCompletion = await client.chat.completions.create({
      messages: [{ role: 'user', content: `Perform sentiment analysis on the following comments of a youtube video posted by "${video_details.channelTitle}" with title "${video_details.title}" and classify it as one of the given labels: the text is hindi written as english, is given in individual numerical points. the output should only contain comma separated labels without spaces and nothing else. ignore the youtube links and html tags.
  Labels: very negative, negative, neutral, positive, very positive.
  comments:
  ${chunk}` }],
      model: 'llama-3.1-8b-instant',
      "temperature": 1,
      // "max_completion_tokens": 1024,
      // "top_p": 1,
      // "stream": true,
      // "stop": null
    });

    // console.log(chatCompletion.choices[0].message.content);
    
    // console.log(chatCompletion.choices[0].message.content)
    console.log("Chunk done "+i)
    i++;
    
    results.push(chatCompletion.choices[0].message.content)
  }

  return decodeCommentAnalysis(comments, results.join(","))
}

const executeCommentAnalysis2 = async (video_details, comments) => {

  const result = await model.generateContent(`Perform sentiment analysis on the following comments of a youtube video posted by "${video_details.channelTitle}" with title "${video_details.title}" and classify it as one of the given labels: the text is hindi written as english, is given in individual numerical points. the output should only contain comma separated labels without space and nothing else. ignore the youtube links and html tags. after classification summarise and give suggestions that the creator can do to improve his videos based on the following comments in 300 words, output only in this format and nothing else :
    Summary: ......
    Suggestions: .......
  Labels: very negative, negative, neutral, positive, very positive.
  comments:
  ${comments.map((c,i)=>`${i+1}. ${c.text}`).join("\n")}`);

  const commentsAnalysis = result.response.text().split("Summary:")[0].replace("\n\n", "")

  return {
    comments: decodeCommentAnalysis(comments, commentsAnalysis),
    summary: result.response.text().split("Summary:")[1].split("Suggestions:")[0],
    suggestions: result.response.text().split("Summary:")[1].split("Suggestions:")[1]
  }
  // return commentsAnalysis.split(",")
}

const getComments = async (videoId) => {
  let comments = [];
  let nextPageToken = "";
  
  do {
    if(comments.length>100) break;
    const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=50&pageToken=${nextPageToken}&key=${process.env.YOUTUBE_API_KEY}&order=relevance`;
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

const getVideoDetails = async (videoId) => {
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${process.env.YOUTUBE_API_KEY}`;
    
    const response = await axios.get(url);
    if (response.data.items.length === 0) {
      return {};
    }

    const snippet = response.data.items[0].snippet;
    return snippet;

  } catch (error) {
    console.error("Error fetching video details:", error.response?.data || error.message);
    return {};
  }
}
