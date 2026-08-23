/**
 * Admin authorization guard middleware.
 * Must be preceded by authMiddleware in the middleware chain.
 * Enforces that req.user.role === "admin" || req.user.role === "super_admin".
 */
function adminMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Authentication required",
    });
  }

  if (req.user.role !== "admin" && req.user.role !== "super_admin") {
    return res.status(403).json({
      error: "forbidden",
      message: "Admin access required. You do not have permission to perform this action.",
    });
  }

  next();
}

/**
 * Super Admin authorization guard middleware.
 * Must be preceded by authMiddleware in the middleware chain.
 * Strictly enforces that req.user.role === "super_admin".
 */
function superAdminMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Authentication required",
    });
  }

  if (req.user.role !== "super_admin") {
    return res.status(403).json({
      error: "forbidden",
      message: "Super admin access required. You do not have permission to perform this action.",
    });
  }

  next();
}

module.exports = adminMiddleware;
module.exports.adminMiddleware = adminMiddleware;
module.exports.superAdminMiddleware = superAdminMiddleware;
