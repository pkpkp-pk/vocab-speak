// Curated offline topic bank. Each topic includes tiered "rescue" keywords —
// revealed progressively so the speaker gets just enough help, not a script.

export const CATEGORIES = [
  { id: "history", label: "History", blurb: "Events, eras & turning points" },
  { id: "society", label: "Society", blurb: "Culture, ethics & everyday life" },
  { id: "tech", label: "Technology", blurb: "Innovation, internet & AI" },
  { id: "personal", label: "Personal", blurb: "Stories, habits & opinions" },
  { id: "world", label: "World & Nature", blurb: "Places, environment & travel" },
  { id: "business", label: "Business", blurb: "Work, money & careers" },
];

export const DIFFICULTIES = [
  { id: "beginner", label: "Beginner", minutes: 2, desc: "Simple, familiar topics" },
  { id: "intermediate", label: "Intermediate", minutes: 3, desc: "Some nuance required" },
  { id: "advanced", label: "Advanced", minutes: 4, desc: "Abstract or debatable topics" },
];

export const TOPICS = [
  {
    id: "india-history",
    category: "history",
    difficulty: "intermediate",
    title: "The History of India",
    prompt: "Talk about India's history — pick any era, event, or thread and follow it.",
    keywords: ["civilization", "independence", "colonial rule", "diversity", "freedom struggle", "ancient empires", "partition", "democracy"],
  },
  {
    id: "industrial-revolution",
    category: "history",
    difficulty: "advanced",
    title: "The Industrial Revolution",
    prompt: "Explain how the Industrial Revolution changed the way people lived and worked.",
    keywords: ["factories", "steam engine", "urbanization", "labor", "mass production", "railways", "child labor", "capitalism"],
  },
  {
    id: "world-war-lessons",
    category: "history",
    difficulty: "advanced",
    title: "Lessons from the World Wars",
    prompt: "What can the world wars teach us about conflict and cooperation today?",
    keywords: ["alliance", "propaganda", "diplomacy", "united nations", "civilian cost", "nationalism", "reconstruction"],
  },
  {
    id: "social-media-effect",
    category: "society",
    difficulty: "intermediate",
    title: "How Social Media Shapes Us",
    prompt: "Discuss how social media affects the way people think, connect, or compare themselves to others.",
    keywords: ["algorithm", "comparison", "validation", "echo chamber", "attention span", "connection", "influencer", "privacy"],
  },
  {
    id: "gender-equality",
    category: "society",
    difficulty: "advanced",
    title: "Gender Equality Today",
    prompt: "Share your view on where gender equality stands today and what still needs to change.",
    keywords: ["opportunity", "wage gap", "representation", "stereotype", "workplace", "upbringing", "policy"],
  },
  {
    id: "joint-vs-nuclear",
    category: "society",
    difficulty: "beginner",
    title: "Joint Families vs. Nuclear Families",
    prompt: "Compare living in a joint family with living in a nuclear family.",
    keywords: ["support system", "privacy", "tradition", "independence", "elders", "shared responsibility"],
  },
  {
    id: "ai-future-work",
    category: "tech",
    difficulty: "advanced",
    title: "AI and the Future of Work",
    prompt: "How do you think artificial intelligence will change the jobs people do?",
    keywords: ["automation", "reskilling", "productivity", "job displacement", "creativity", "human oversight", "ethics"],
  },
  {
    id: "smartphones-daily-life",
    category: "tech",
    difficulty: "beginner",
    title: "How Smartphones Changed Daily Life",
    prompt: "Talk about how smartphones have changed an ordinary day for most people.",
    keywords: ["convenience", "distraction", "communication", "apps", "screen time", "navigation", "connectivity"],
  },
  {
    id: "data-privacy",
    category: "tech",
    difficulty: "intermediate",
    title: "Data Privacy in the Digital Age",
    prompt: "Discuss why data privacy matters and whether people give it up too easily.",
    keywords: ["consent", "tracking", "personal data", "security breach", "terms and conditions", "surveillance"],
  },
  {
    id: "favorite-hobby",
    category: "personal",
    difficulty: "beginner",
    title: "A Hobby You Love",
    prompt: "Talk about a hobby you enjoy and why it matters to you.",
    keywords: ["relaxation", "skill", "passion", "free time", "practice", "community", "creativity"],
  },
  {
    id: "a-lesson-learned",
    category: "personal",
    difficulty: "intermediate",
    title: "A Lesson You Learned the Hard Way",
    prompt: "Describe a mistake or setback that taught you something important.",
    keywords: ["failure", "reflection", "growth", "responsibility", "second chance", "resilience"],
  },
  {
    id: "ideal-weekend",
    category: "personal",
    difficulty: "beginner",
    title: "Your Ideal Weekend",
    prompt: "Describe what your perfect weekend would look like from start to finish.",
    keywords: ["relaxation", "friends", "outdoors", "routine", "balance", "adventure"],
  },
  {
    id: "climate-change",
    category: "world",
    difficulty: "advanced",
    title: "Climate Change and Everyday Choices",
    prompt: "How do individual choices connect to the bigger problem of climate change?",
    keywords: ["carbon footprint", "renewable energy", "consumption", "policy", "sustainability", "responsibility"],
  },
  {
    id: "dream-travel",
    category: "world",
    difficulty: "beginner",
    title: "A Place You'd Love to Visit",
    prompt: "Talk about a place you dream of visiting and what draws you to it.",
    keywords: ["culture", "landscape", "cuisine", "adventure", "history", "language"],
  },
  {
    id: "urban-vs-rural",
    category: "world",
    difficulty: "intermediate",
    title: "City Life vs. Village Life",
    prompt: "Compare the advantages of living in a city with living in a village.",
    keywords: ["pace of life", "opportunity", "pollution", "community", "cost of living", "nature", "infrastructure"],
  },
  {
    id: "entrepreneurship",
    category: "business",
    difficulty: "intermediate",
    title: "Starting Your Own Business",
    prompt: "Discuss what it takes to start a business and why many people are drawn to it.",
    keywords: ["risk", "capital", "idea validation", "persistence", "market demand", "failure", "independence"],
  },
  {
    id: "remote-work",
    category: "business",
    difficulty: "beginner",
    title: "Working From Home",
    prompt: "Talk about the pros and cons of working from home versus an office.",
    keywords: ["flexibility", "productivity", "isolation", "commute", "work-life balance", "collaboration"],
  },
  {
    id: "leadership-qualities",
    category: "business",
    difficulty: "advanced",
    title: "What Makes a Good Leader",
    prompt: "Explain what qualities you believe define a truly good leader.",
    keywords: ["empathy", "vision", "accountability", "communication", "integrity", "decision-making"],
  },
  {
    id: "space-race",
    category: "history",
    difficulty: "intermediate",
    title: "The Space Race",
    prompt: "Talk about the race to space and why it captured the world's imagination.",
    keywords: ["cold war", "moon landing", "rivalry", "exploration", "engineering", "national pride"],
  },
  {
    id: "ancient-trade-routes",
    category: "history",
    difficulty: "beginner",
    title: "The Silk Road",
    prompt: "Describe how the Silk Road connected distant civilizations and what it exchanged.",
    keywords: ["trade", "caravan", "spices", "cultural exchange", "merchants", "connection"],
  },
  {
    id: "mental-health-awareness",
    category: "society",
    difficulty: "intermediate",
    title: "Talking Openly About Mental Health",
    prompt: "Discuss why mental health is still hard for many people to talk about openly.",
    keywords: ["stigma", "support system", "therapy", "vulnerability", "awareness", "burnout"],
  },
  {
    id: "traditional-vs-modern-values",
    category: "society",
    difficulty: "beginner",
    title: "Traditional Values vs. Modern Life",
    prompt: "Compare how traditional values sit alongside a fast-changing modern life.",
    keywords: ["tradition", "generation gap", "adaptation", "family expectations", "change"],
  },
  {
    id: "social-robots",
    category: "tech",
    difficulty: "advanced",
    title: "Robots as Companions",
    prompt: "Share your view on robots or AI companions becoming part of everyday emotional life.",
    keywords: ["loneliness", "artificial companionship", "ethics", "dependency", "emotional bond", "innovation"],
  },
  {
    id: "online-education",
    category: "tech",
    difficulty: "beginner",
    title: "Learning Online",
    prompt: "Talk about the benefits and drawbacks of learning through online courses.",
    keywords: ["flexibility", "self-discipline", "accessibility", "distraction", "interaction", "affordability"],
  },
  {
    id: "person-who-inspired-you",
    category: "personal",
    difficulty: "beginner",
    title: "Someone Who Inspired You",
    prompt: "Talk about a person who has genuinely inspired you and why.",
    keywords: ["role model", "influence", "example", "determination", "gratitude", "values"],
  },
  {
    id: "biggest-fear",
    category: "personal",
    difficulty: "intermediate",
    title: "Facing a Fear",
    prompt: "Describe a fear you've faced or are still working on overcoming.",
    keywords: ["courage", "discomfort", "avoidance", "growth", "vulnerability", "confidence"],
  },
  {
    id: "national-parks",
    category: "world",
    difficulty: "intermediate",
    title: "Why Protected Nature Matters",
    prompt: "Discuss why protecting natural spaces like parks and forests matters today.",
    keywords: ["biodiversity", "conservation", "ecosystem", "tourism", "habitat", "future generations"],
  },
  {
    id: "food-culture",
    category: "world",
    difficulty: "beginner",
    title: "Food Around the World",
    prompt: "Talk about a cuisine or dish from another culture that fascinates you.",
    keywords: ["flavor", "tradition", "spices", "street food", "recipe", "hospitality"],
  },
  {
    id: "networking-importance",
    category: "business",
    difficulty: "beginner",
    title: "The Value of Networking",
    prompt: "Talk about why building professional relationships matters for a career.",
    keywords: ["connections", "opportunity", "trust", "referral", "mentorship", "reputation"],
  },
  {
    id: "work-life-balance",
    category: "business",
    difficulty: "intermediate",
    title: "Finding Work-Life Balance",
    prompt: "Discuss how people can balance ambition at work with a healthy personal life.",
    keywords: ["boundaries", "burnout", "priorities", "flexibility", "downtime", "productivity"],
  },
];

export function getTopicsByFilter(pool, { category, difficulty }) {
  return pool.filter(
    (t) =>
      (category === "all" || t.category === category) &&
      (difficulty === "all" || t.difficulty === difficulty)
  );
}

export function getRandomTopic(pool, { category = "all", difficulty = "all", excludeId = null } = {}) {
  const filtered = getTopicsByFilter(pool, { category, difficulty }).filter((t) => t.id !== excludeId);
  const source = filtered.length ? filtered : pool.filter((t) => t.id !== excludeId);
  const finalSource = source.length ? source : pool;
  return finalSource[Math.floor(Math.random() * finalSource.length)];
}
