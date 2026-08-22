const express = require("express");
const Faq = require("../models/Faq");
const { authMiddleware } = require("../middleware/auth");
const { connectToDatabase } = require("../config/db");

const router = express.Router();

const initialFaqs = [
  {
    question: "Do I need an account to use OCS?",
    answer: "Yes — OCS uses web-redirect organization authentication. Once signed in, desktop apps cache credentials locally with an offline grace period so live services are never interrupted.",
    category: "Account & Authentication",
    order: 1,
    isActive: true,
  },
  {
    question: "What are the system requirements?",
    answer: "Desktop: macOS 12+ (Apple Silicon & Intel) or Windows 10/11 (64-bit). Mobile Companion: Android 10+ or iOS 15+. A local Wi-Fi or LAN connection is recommended for multi-device sync.",
    category: "System Requirements",
    order: 2,
    isActive: true,
  },
  {
    question: "How does Church Organization Licensing work?",
    answer: "OCS is licensed per church/organization. An administrator registers the ministry account and invites team members, worship leaders, and AV volunteers.",
    category: "Licensing",
    order: 3,
    isActive: true,
  },
  {
    question: "How do I update OCS?",
    answer: "OCS checks for updates automatically on launch. Updates are staged non-destructively and will never interrupt an active live service timer.",
    category: "Updates & Maintenance",
    order: 4,
    isActive: true,
  },
  {
    question: "Does speech recognition work offline during live services?",
    answer: "Yes! OCS uses embedded, local in-process AI models (Vosk and Whisper.cpp) running directly on your CPU/GPU without sending church audio to the cloud.",
    category: "AI & Offline Engine",
    order: 5,
    isActive: true,
  },
  {
    question: "Can we stream video and lower thirds to OBS or vMix?",
    answer: "Yes. OCS provides native NDI video output feeds and transparent web overlay URLs ready to be imported into OBS Studio, vMix, and ATEM switchers.",
    category: "Broadcasting & NDI",
    order: 6,
    isActive: true,
  },
];

/**
 * GET /faqs
 * Public & Unauthenticated endpoint to fetch all active FAQs.
 * Auto-seeds initial FAQs if collection is empty.
 */
router.get("/faqs", async (req, res, next) => {
  try {
    await connectToDatabase();

    let count = await Faq.countDocuments();
    if (count === 0) {
      await Faq.insertMany(initialFaqs);
    }

    const faqs = await Faq.find({ isActive: true }).sort({ order: 1, createdAt: -1 });

    res.json({
      success: true,
      count: faqs.length,
      faqs,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /faqs
 * Protected endpoint to create a new FAQ item.
 * Requires valid authentication token (Bearer token).
 */
router.post("/faqs", authMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();

    const { question, answer, category = "General", order = 0 } = req.body;

    if (!question || !answer) {
      return res.status(400).json({
        error: "missing_fields",
        message: "Question and answer are required",
      });
    }

    const faq = await Faq.create({
      question: String(question).trim(),
      answer: String(answer).trim(),
      category: String(category).trim(),
      order: Number(order) || 0,
      isActive: true,
    });

    res.status(201).json({
      success: true,
      message: "FAQ created successfully",
      faq,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /faqs/:id
 * Protected endpoint to delete an FAQ item.
 * Requires valid authentication token (Bearer token).
 */
router.delete("/faqs/:id", authMiddleware, async (req, res, next) => {
  try {
    await connectToDatabase();

    const { id } = req.params;
    const faq = await Faq.findByIdAndDelete(id);

    if (!faq) {
      return res.status(404).json({
        error: "not_found",
        message: "FAQ not found",
      });
    }

    res.json({
      success: true,
      message: "FAQ deleted successfully",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
