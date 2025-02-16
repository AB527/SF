require("dotenv").config();
const axios = require('axios');
const Groq = require('groq-sdk');
const express = require('express');
const cors = require("cors");
const verifyURL = require("./verifyUrl");
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(cors());

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
  res.send('Hello World!');
});

const getChannelData = async (curl) => {
  try {
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
  } catch (error) {
    console.error("Error fetching channel data:", error);
    throw new Error("Failed to fetch channel data");
  }
};

app.post('/getChannelData', async (req, res) => {
  try {
    const data = await getChannelData(req.body.url);
    res.send(data);
  } catch (error) {
    res.status(500).send({ success: false, msg: error.message });
  }
});

app.post('/getChannelId', async (req, res) => {
  try {
    let channelId = await getChannelId(req.body.url);
    res.send({ success: !!channelId.length, msg: channelId });
  } catch (error) {
    res.status(500).send({ success: false, msg: error.message });
  }
});

const getChannelId = async (url) => {
  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${url.split("@")[1].split("/")[0]}&type=channel&key=${process.env.YOUTUBE_API_KEY}`;
    const searchResponse = await axios.get(searchUrl);

    if (searchResponse.data.items.length === 0) {
      return "";
    }
    return searchResponse.data.items[0].id.channelId;
  } catch (error) {
    console.error("Error fetching channel ID:", error);
    throw new Error("Failed to fetch channel ID");
  }
};

app.post('/getContentAnalysis', async (req, res) => {
  try {
    var url = new URL(req.body.url);
    const videoId = url.searchParams.get('v');
    let videoDetails = await getVideoDetails(videoId);
    let comments = await getComments(videoId);
    const analysis = await executeCommentAnalysis2(videoDetails, comments);
    res.send(analysis);
  } catch (err) {
    console.error("Error in content analysis:", err);
    res.status(400).send({ success: false, msg: "Invalid URL or failed to analyze content" });
  }
});

app.post('/getChannelAnalysis', async (req, res) => {
  try {
    let videos = await getChannelData(req.body.url);
    let comments = []
    for(var v of videos.slice(0,5)) {
      comments.push(await getComments(v.videoId))
    }
    res.send({
      ...await executeCommentAnalysis3({
        title: req.body.url.split("@")[1].split("/")[0],
        videos: videos
      }, comments),
      videos: videos
    });
  } catch (error) {
    console.error("Error in channel analysis:", error);
    res.status(500).send({ success: false, msg: "Failed to analyze channel" });
  }
});

app.post('/verifyContentUrl', async (req, res) => {
  try {
    var url = new URL(req.body.url);
    const verification = await verifyURL(req.body.url);
    res.send(verification);
  } catch (err) {
    res.status(400).send({ success: false, msg: "Invalid URL" });
  }
});

app.post('/getVideoComments', async (req, res) => {
  try {
    const comments = (await getComments(req.body.videoId)).map((c, i) => `${i + 1}. ${c.text}`).join("\n");
    res.send(comments);
  } catch (error) {
    console.error("Error fetching video comments:", error);
    res.status(500).send({ success: false, msg: "Failed to fetch comments" });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const url = new URL(req.body.url);
    const videoId = url.searchParams.get('v');
    let comments = (await getComments(videoId))
      .map((c, i) => `${i + 1}. ${c.text}`)
      .join("\n");

    const generationConfig = {
      temperature: 1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
      responseMimeType: "text/plain",
    };

    let history = req.body.history || [];
    history.unshift({
      role: "user",
      parts: [{ text: `You are an assistant that helps analyze YouTube comments. Here are the comments:\n\n${comments}` }]
    });

    history = history.map(msg => ({
      role: msg.role,
      parts: Array.isArray(msg.parts) ? msg.parts : [{ text: msg.content }]
    }));

    const chatSession = model.startChat({ generationConfig, history });
    const result = await chatSession.sendMessage(req.body.newInput);

    res.send({ content: result.response.text() });
  } catch (error) {
    console.error("Error in chat processing:", error);
    res.status(500).send({ error: "Something went wrong" });
  }
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});

function decodeCommentAnalysis(comments, analysis) {
  const wordToCode = ["very negative", "negative", "neutral", "positive", "very positive"];

  analysis = analysis.split(",")
    .filter(l => l !== undefined && l !== "")
    .map(l => wordToCode.indexOf(l) + 1);

  let stats = analysis.reduce((acc, curr) => {
    let key = curr.toString();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

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

function decodeCommentAnalysis2(analysis) {
  const wordToCode = ["very negative", "negative", "neutral", "positive", "very positive"];

  analysis = analysis.split(",")
    .filter(l => l !== undefined && l !== "")
    .map(l => wordToCode.indexOf(l) + 1);

  let stats = analysis.reduce((acc, curr) => {
    let key = curr.toString();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Remove any key not in the range 1-5
  stats = Object.fromEntries(
    Object.entries(stats).filter(([key]) => key >= '1' && key <= '5')
  );

  // Ensure keys 1-5 exist with default value 0 if missing
  for (let i = 1; i <= 5; i++) {
    let key = i.toString();
    if (!(key in stats)) {
      stats[key] = 0;
    }
  }

  return stats;
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
  try {
    let results = [];
    let commentChunks = chunkArray(comments.map(c => c.text));
    var initLimit = commentChunks[0].length;
    commentChunks = commentChunks.map(ch => ch.map((c, i) => `${i + 1}. ${c}`).join("\n"));

    var i = 0;
    for (const chunk of commentChunks) {
      const chatCompletion = await client.chat.completions.create({
        messages: [{ role: 'user', content: `Perform sentiment analysis on the following comments of a youtube video posted by "${video_details.channelTitle}" with title "${video_details.title}" and classify it as one of the given labels: the text is hindi written as english, is given in individual numerical points. the output should only contain comma separated labels without spaces and nothing else. ignore the youtube links and html tags.
  Labels: very negative, negative, neutral, positive, very positive.
  comments:
  ${chunk}` }],
        model: 'llama-3.1-8b-instant',
        temperature: 1,
      });

      results.push(chatCompletion.choices[0].message.content);
      i++;
    }

    return decodeCommentAnalysis(comments, results.join(","));
  } catch (error) {
    console.error("Error in comment analysis:", error);
    throw new Error("Failed to analyze comments");
  }
};

const executeCommentAnalysis2 = async (video_details, comments) => {
  try {
    const result = await model.generateContent(`Perform sentiment analysis on the following comments of a youtube video posted by "${video_details.channelTitle}" with title "${video_details.title}" and classify it as one of the given labels: the text is hindi written as english, is given in individual numerical points. the output should only contain comma separated labels without space and nothing else. ignore the youtube links and html tags. after classification summarise and give suggestions that the creator can do to improve his videos based on the following comments in 300 words, output only in this format and nothing else :
    Summary: ......
    Suggestions:.......
  Labels: very negative, negative, neutral, positive, very positive.
  comments:
  ${comments.map((c, i) => `${i + 1}. ${c.text}`).join("\n")}`);

    const commentsAnalysis = result.response.text().split("Summary:")[0].replace("\n\n", "");

    return {
      comments: decodeCommentAnalysis(comments, commentsAnalysis),
      summary: result.response.text().split("Summary:")[1].split("Suggestions:")[0],
      suggestions: result.response.text().split("Summary:")[1].split("Suggestions:")[1]
    };
  } catch (error) {
    console.error("Error in comment analysis 2:", error);
    throw new Error("Failed to analyze comments");
  }
};

const executeCommentAnalysis3 = async (channel_details, comments) => {
  console.log(comments.length)
  let comment2=comments.map((v,i)=>`\nVideo: ${channel_details.videos[i].title}\n\n${v.map((c, i) => `${i + 1}. ${c.text}`).join("\n")}`).join("\n")
  // console.log(comment2)
  try {
    const result = await model.generateContent(`Perform sentiment analysis on the following comments of latest five youtube videos of youtube channel "${channel_details.videos[0].title}" and classify it as one of the given labels. the text is hindi written as english, is given in individual numerical points. the output should only contain comma separated labels without space for every comment of every video, together and nothing else. ignore the youtube links and html tags.
  Labels: very negative, negative, neutral, positive, very positive.
  comments:
  ${comment2}`);

    return {
      stats: decodeCommentAnalysis2(result.response.text())
    };
  } catch (error) {
    console.error("Error in comment analysis 2:", error);
    throw new Error("Failed to analyze comments");
  }
};

const getComments = async (videoId) => {
  try {
    let comments = [];
    let nextPageToken = "";

    do {
      if (comments.length > 100) break;
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

    comments = [...new Map(comments.map(item => [item['text'], item])).values()];
    return comments;
  } catch (error) {
    console.error("Error fetching comments:", error);
    throw new Error("Failed to fetch comments");
  }
};

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
    console.error("Error fetching video details:", error);
    throw new Error("Failed to fetch video details");
  }
};