const mongoose = require('mongoose');

const ticketNoteSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      index: true,
    },
    note: {
      type: String,
      required: [true, 'Note text is required'],
      trim: true,
      maxlength: [5000, 'Note cannot exceed 5000 characters'],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

const TicketNote =
  mongoose.models.TicketNote || mongoose.model('TicketNote', ticketNoteSchema);

module.exports = TicketNote;
