import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Zod schema for structured output
const TravelGuideSchema = z.object({
  formattedCityName: z.string(),
  emojiForCity: z.string(),
  attractions: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      tags: z.array(z.string())
    })
  )
});

const getClaudeResponse = async (city, flavor) => {
  let model = "claude-3-5-sonnet";

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: `Always respond with JSON following this schema:
    {
      formattedCityName: string_as_title_case,
      emojiForCity: string,
      attractions: [
        {
          name: string,
          description: string,
          tags: string[]
        },
        ...
      ]
    }`,
    messages: [
      {
        role: "user",
        content: `What are the top 10 attractions in ${city}, be very ${flavor}`
      }
    ]
  });

  const data = JSON.parse(response.content[0].text);

  return { ...data, model };
};

const getGPTResponse = async (city, flavor) => {
  let model = "gpt-4o-mini";
  const response = await openai.responses.parse({
    model,
    input: [
      {
        role: "user",
        content: `What are the top 10 attractions in ${city}, be very ${flavor}`
      }
    ],
    text: {
      format: zodTextFormat(TravelGuideSchema, "travel_guide")
    }
  });

  const data = response.output_parsed;

  return { ...data, model };
};

const getWikiData = async (query, size = "1024px") => {
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

  const wikiPage = wikiData.pages?.[0];

  if (!wikiData?.pages || !wikiPage) {
    return {
      image: null,
      wikipediaId: null
    };
  }

  return {
    image: wikiPage.thumbnail?.url?.replace(/60px/, size) || null,
    wikipediaId: wikiPage.id || null
  };
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
    try {
      const data = await getGPTResponse(city, flavor);

      const { formattedCityName, emojiForCity, attractions, model } = data;

      const attractionsWithImages = await Promise.all(
        attractions.map(async (attraction) => {
          const query = encodeURIComponent(`${attraction.name} ${city}`);
          const { image, wikipediaId } = await getWikiData(query);

          return {
            ...attraction,
            image,
            wikipediaId
          };
        })
      );

      const guide = {
        metadata: {
          city: formattedCityName,
          emoji: emojiForCity,
          flavor,
          createdAt: new Date(),
          model
        },
        attractions: attractionsWithImages
      };

      const { image } = await getWikiData(city, "1024px");

      guide.metadata.headerImage = image;

      if (!fs.existsSync("./guides")) {
        fs.mkdirSync("./guides");
      }

      fs.writeFileSync(
        path.join("./guides", filename),
        JSON.stringify(guide, null, 2)
      );

      res.json(guide);
    } catch (error) {
      console.error("Error fetching guide:", error);
      try {
        const data = await getGPTResponse(city, flavor);

        const { formattedCityName, emojiForCity, attractions, model } = data;

        const attractionsWithImages = await Promise.all(
          attractions.map(async (attraction) => {
            const query = encodeURIComponent(`${attraction.name} ${city}`);
            const { image, wikipediaId } = await getWikiData(query);

            return {
              ...attraction,
              image,
              wikipediaId
            };
          })
        );

        const guide = {
          metadata: {
            city: formattedCityName,
            emoji: emojiForCity,
            flavor,
            createdAt: new Date(),
            model
          },
          attractions: attractionsWithImages
        };

        const { image } = await getWikiData(city, "1024px");

        guide.metadata.headerImage = image;

        if (!fs.existsSync("./guides")) {
          fs.mkdirSync("./guides");
        }

        fs.writeFileSync(
          path.join("./guides", filename),
          JSON.stringify(guide, null, 2)
        );

        res.json(guide);
      } catch (gptError) {
        console.error("Error fetching guide with GPT:", gptError);
        res.status(500).json({
          error: "Failed to generate guide",
          message: "Both Claude and GPT failed to generate the guide."
        });
      }
    }
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
