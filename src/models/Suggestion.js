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
