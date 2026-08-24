const mongoose = require('mongoose');

const suggestionSchema = new mongoose.Schema(
  {
    suggestionId: {
      type: String,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    church: {
      type: String,
      trim: true,
      default: 'General Ministry',
    },
    category: {
      type: String,
      required: true,
      trim: true,
      default: 'Live Presentation & Projection',
    },
    impact: {
      type: String,
      enum: ['nice_to_have', 'high_value', 'critical'],
      default: 'high_value',
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['under_review', 'planned', 'in_development', 'completed', 'declined'],
      default: 'under_review',
      index: true,
    },
    upvotes: {
      type: Number,
      default: 1,
    },
    downvotes: {
      type: Number,
      default: 0,
    },
    voters: [
      {
        voterKey: { type: String, required: true },
        voteType: { type: String, enum: ['up', 'down'], required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    comments: [
      {
        commentId: {
          type: String,
          default: () => `cm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        },
        name: { type: String, required: true, trim: true },
        email: { type: String, trim: true, default: '' },
        church: { type: String, trim: true, default: 'Church Tech Team' },
        content: { type: String, required: true, trim: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    adminNotes: {
      type: String,
      default: '',
    },
    isPublic: {
      type: Boolean,
      default: true,
    },
    isReadByAdmin: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

suggestionSchema.pre('save', function (next) {
  if (!this.suggestionId) {
    this.suggestionId = `SUG-${Math.floor(10000 + Math.random() * 90000)}`;
  }
  next();
});

const Suggestion =
  mongoose.models.Suggestion || mongoose.model('Suggestion', suggestionSchema);

module.exports = Suggestion;
