import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import cors from "cors";

dotenv.config();

const app = express();
const port = 3106;

app.use(cors());
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const getWikiImage = async (query, size = "1024px") => {
  const wikiResponse = await fetch(
    `https://en.wikipedia.org/w/rest.php/v1/search/page?format=json&q=${query}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    }
  );

  const wikiData = await wikiResponse.json();

  return wikiData.pages?.[0]?.thumbnail?.url?.replace(/60px/, size) || null;
};

app.get("/", async (req, res) => {
  const { city, flavor } = req.query;

  if (!city || !flavor) {
    return res.status(400).json({
      error: "Missing required parameters",
      message: "Both 'city' and 'flavor' query parameters are required"
    });
  }

  const filename = `${city.toLowerCase().replace(/\s+/g, "")}-${flavor
    .toLowerCase()
    .replace(/\s+/g, "")}.json`;
  const guidePath = path.join("./guides", filename);

  if (fs.existsSync(guidePath)) {
    const existingGuide = JSON.parse(fs.readFileSync(guidePath, "utf8"));
    res.json(existingGuide);
  } else {
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: `Always respond with JSON following this schema:
      [
        {
          "name": string,
          "description": string,
          "tags": string[]
        },
        {
          "name": string,
          "description": string,
          "tags": string[]
        },
        ...
      ]`,
      messages: [
        {
          role: "user",
          content: `What are the top 10 attractions in ${city}, be very ${flavor}`
        }
      ]
    });

    const attractions = JSON.parse(response.content[0].text);

    const attractionsWithImages = await Promise.all(
      attractions.map(async (attraction) => {
        const query = encodeURIComponent(`${attraction.name} ${city}`);
        const image = await getWikiImage(query);

        return {
          ...attraction,
          image
        };
      })
    );

    const guide = {
      metadata: {
        city,
        flavor,
        createdAt: new Date().toISOString()
      },
      attractions: attractionsWithImages
    };

    guide.metadata.headerImage = await getWikiImage(city, "1024px");

    if (!fs.existsSync("./guides")) {
      fs.mkdirSync("./guides");
    }

    fs.writeFileSync(
      path.join("./guides", filename),
      JSON.stringify(guide, null, 2)
    );

    res.json(guide);
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
