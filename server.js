const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// Serve static files, but do NOT automatically serve index.html at "/"
app.use(express.static(__dirname, { index: false }));

function normalizeText(value) {
  return (value || "").toLowerCase();
}

function getBudgetRank(budget) {
  const budgetMap = {
    under_15: 1,
    "15_30": 2,
    "30_50": 3,
    "50_plus": 4
  };
  return budgetMap[budget] || 999;
}

function estimatePriceBucket(productName) {
  const name = normalizeText(productName);

  if (
    name.includes("luxury") ||
    name.includes("premium") ||
    name.includes("advanced")
  ) {
    return "30_50";
  }

  return "15_30";
}

function inferCategory(name, categoriesText) {
  const text = `${name} ${categoriesText}`.toLowerCase();

  if (text.includes("foundation")) return "foundation";
  if (text.includes("concealer")) return "concealer";
  if (text.includes("primer")) return "primer";
  if (text.includes("cleanser")) return "cleanser";
  if (text.includes("moisturizer") || text.includes("cream")) return "moisturizer";
  if (text.includes("serum")) return "serum";
  if (text.includes("sunscreen") || text.includes("spf")) return "spf";
  if (text.includes("blush")) return "blush";

  return "unknown";
}

function inferFinish(name, ingredientsText) {
  const text = `${name} ${ingredientsText}`.toLowerCase();
  if (text.includes("matte")) return "matte";
  if (text.includes("dewy") || text.includes("glow") || text.includes("radiant")) return "dewy";
  if (text.includes("natural")) return "natural";
  return null;
}

function inferCoverage(name) {
  const text = name.toLowerCase();
  if (text.includes("full coverage")) return "full";
  if (text.includes("medium coverage")) return "medium";
  if (text.includes("sheer")) return "sheer";
  return null;
}

function inferSkinTypes(name, ingredientsText) {
  const text = `${name} ${ingredientsText}`.toLowerCase();
  const types = [];

  if (text.includes("oil control") || text.includes("salicylic")) {
    types.push("oily", "combination");
  }

  if (
    text.includes("hyaluronic") ||
    text.includes("ceramide") ||
    text.includes("squalane") ||
    text.includes("hydrating")
  ) {
    types.push("dry", "normal", "combination");
  }

  if (
    text.includes("sensitive") ||
    text.includes("centella") ||
    text.includes("panthenol") ||
    !text.includes("fragrance")
  ) {
    types.push("sensitive");
  }

  if (types.length === 0) {
    types.push("normal", "combination");
  }

  return [...new Set(types)];
}

function inferConcerns(name, ingredientsText) {
  const text = `${name} ${ingredientsText}`.toLowerCase();
  const concerns = [];

  if (text.includes("salicylic") || text.includes("acne")) concerns.push("acne");
  if (text.includes("niacinamide") || text.includes("redness") || text.includes("centella")) concerns.push("redness");
  if (text.includes("hyaluronic") || text.includes("ceramide") || text.includes("dry")) concerns.push("dryness");
  if (text.includes("vitamin c") || text.includes("dark spot")) concerns.push("dark_spots");
  if (text.includes("pore") || text.includes("niacinamide")) concerns.push("large_pores");
  if (text.includes("texture") || text.includes("aha") || text.includes("bha")) concerns.push("texture");

  return [...new Set(concerns)];
}

function mapOpenBeautyFactsProduct(raw) {
  const name = raw.product_name || raw.product_name_en || "Unknown Product";
  const brand = raw.brands || "Unknown Brand";
  const ingredientsText = normalizeText(raw.ingredients_text || "");
  const categoriesText = normalizeText(raw.categories || "");
  const imageUrl = raw.image_front_url || raw.image_url || null;

  const category = inferCategory(name, categoriesText);
  const finish = inferFinish(name, ingredientsText);
  const coverage = inferCoverage(name);
  const suitableSkinTypes = inferSkinTypes(name, ingredientsText);
  const concernsSupported = inferConcerns(name, ingredientsText);
  const fragranceFree =
    !ingredientsText.includes("fragrance") &&
    !ingredientsText.includes("parfum");

  return {
    id: raw.code || name,
    brand,
    name,
    category,
    suitableSkinTypes,
    concernsSupported,
    fragranceFree,
    finish,
    coverage,
    budgetRange: estimatePriceBucket(name),
    toneBands: ["light", "medium", "tan", "deep"],
    undertones: ["warm", "cool", "neutral"],
    photoTraits: {
      goodForShine:
        name.toLowerCase().includes("matte") ||
        name.toLowerCase().includes("oil control") ||
        name.toLowerCase().includes("balancing"),
      goodForDryness:
        ingredientsText.includes("glycerin") ||
        ingredientsText.includes("hyaluronic") ||
        ingredientsText.includes("ceramide") ||
        name.toLowerCase().includes("hydrating"),
      goodForRedness:
        ingredientsText.includes("niacinamide") ||
        ingredientsText.includes("centella") ||
        ingredientsText.includes("panthenol") ||
        fragranceFree
    },
    imageUrl,
    description: raw.generic_name || "Real product match from external catalog."
  };
}

function scoreQuizProduct(product, user) {
  let score = 0;
  const reasons = [];

  if (product.category !== user.requestedCategory) {
    return { score: -999, reasons: ["Wrong category."] };
  }

  score += 40;
  reasons.push("Matches your selected product category.");

  if (product.suitableSkinTypes.includes(user.primarySkinType)) {
    score += 25;
    reasons.push(`Works well for ${user.primarySkinType} skin.`);
  }

  if (user.sensitivityLevel === "High" && product.fragranceFree) {
    score += 18;
    reasons.push("Fragrance-free, which is helpful for sensitive skin.");
  }

  if (user.fragrancePreference === "fragrance_free" && product.fragranceFree) {
    score += 15;
    reasons.push("Matches your fragrance-free preference.");
  }

  if (product.finish && user.finishPreference === product.finish) {
    score += 12;
    reasons.push(`Matches your ${user.finishPreference} finish preference.`);
  }

  if (product.coverage && user.coveragePreference === product.coverage) {
    score += 10;
    reasons.push(`Matches your ${user.coveragePreference} coverage preference.`);
  }

  const matchingConcerns = (user.concerns || []).filter((c) =>
    product.concernsSupported.includes(c)
  );

  if (matchingConcerns.length > 0) {
    score += matchingConcerns.length * 8;
    reasons.push(`Supports your concerns: ${matchingConcerns.join(", ")}.`);
  }

  if (product.budgetRange === user.budget) {
    score += 10;
    reasons.push("Fits your budget range.");
  } else {
    const userBudgetRank = getBudgetRank(user.budget);
    const productBudgetRank = getBudgetRank(product.budgetRange);

    if (productBudgetRank < userBudgetRank) {
      score += 4;
      reasons.push("Costs less than your maximum budget.");
    } else if (productBudgetRank > userBudgetRank) {
      score -= 8;
    }
  }

  return { score, reasons };
}

function scorePhotoProduct(product, user) {
  let score = 0;
  const reasons = [];

  if (product.category !== user.requestedCategory) {
    return { score: -999, reasons: ["Wrong category."] };
  }

  score += 35;
  reasons.push("Matches your selected product category.");

  if (user.toneBand && product.toneBands?.includes(user.toneBand)) {
    score += 18;
    reasons.push(`Matches your estimated ${user.toneBand} tone range.`);
  }

  if (user.undertone && product.undertones?.includes(user.undertone)) {
    score += 14;
    reasons.push(`Matches your estimated ${user.undertone} undertone.`);
  }

  if (user.cameraAnalysis) {
    if (user.cameraAnalysis.shineScore >= 0.55 && product.photoTraits?.goodForShine) {
      score += 16;
      reasons.push("Better match for higher shine.");
    }

    if (user.cameraAnalysis.drynessScore >= 0.55 && product.photoTraits?.goodForDryness) {
      score += 16;
      reasons.push("Better match for dryness.");
    }

    if (user.cameraAnalysis.rednessScore >= 0.4 && product.photoTraits?.goodForRedness) {
      score += 16;
      reasons.push("Better match for redness.");
    }

    if (
      typeof user.cameraAnalysis.confidence === "number" &&
      user.cameraAnalysis.confidence < 0.5
    ) {
      score -= 6;
      reasons.push("Photo confidence was lower, so this result may be less reliable.");
    }
  }

  if (product.fragranceFree) {
    score += 6;
    reasons.push("Fragrance-free products are often a safer match.");
  }

  return { score, reasons };
}

async function fetchOpenBeautyFactsProducts(category) {
  const params = new URLSearchParams({
    page_size: "50",
    fields: [
      "code",
      "product_name",
      "product_name_en",
      "brands",
      "ingredients_text",
      "categories",
      "generic_name",
      "image_front_url",
      "image_url"
    ].join(",")
  });

  if (category) {
    params.set("search_terms", category);
  }

  const url = `https://world.openbeautyfacts.org/cgi/search.pl?json=1&search_simple=1&action=process&${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "glowmatch/1.0 (student project)"
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`OpenBeautyFacts returned ${response.status}`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error(
      `Expected JSON but got ${contentType || "unknown"}: ${bodyText.slice(0, 120)}`
    );
  }

  return JSON.parse(bodyText);
}

app.post("/api/recommend", async (req, res) => {
  try {
    const user = req.body;
    const data = await fetchOpenBeautyFactsProducts(user.requestedCategory);

    const mappedProducts = (data.products || [])
      .map(mapOpenBeautyFactsProduct)
      .filter((p) => p.category === user.requestedCategory);

    const quizSorted = mappedProducts
      .map((p) => {
        const result = scoreQuizProduct(p, user);
        return { ...p, matchScore: result.score, reasons: result.reasons };
      })
      .filter((p) => p.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore);

    const photoSorted = mappedProducts
      .map((p) => {
        const result = scorePhotoProduct(p, user);
        return { ...p, matchScore: result.score, reasons: result.reasons };
      })
      .filter((p) => p.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore);

    res.json({
      quizBest: quizSorted[0] || null,
      photoBest: photoSorted[0] || null
    });
  } catch (error) {
    console.error("Recommendation error:", error.message);
    res.status(500).json({
      error: "Failed to fetch real products.",
      details: error.message
    });
  }
});

// Make the homepage be home.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "home.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});