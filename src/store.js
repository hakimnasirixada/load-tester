/**
 * In-Memory Data Store
 * Pre-seeded with 7,000 users (10% Admins, 90% Peers)
 * Contains tables, records, and indexed lookups.
 */
class DataStore {
  constructor() {
    this.users = new Map();         // id -> user
    this.usersList = [];            // Array for fast random access
    this.adminUserIds = [];
    this.peerUserIds = [];

    this.records = [];              // 10,000+ mock records for peer feeds/reads
    this.recordsById = new Map();

    this.tableData = new Map();     // Simulated custom tables

    this.seed();
  }

  seed() {
    console.log('Seeding in-memory database with 7,000 users...');
    const TOTAL_USERS = 7000;
    const ADMIN_RATIO = 0.10; // 10% admins = 700 admins

    const roles = ['admin', 'peer'];
    const departments = ['Engineering', 'Finance', 'Operations', 'Product', 'Support', 'Legal', 'Sales'];
    const statuses = ['active', 'idle', 'suspended'];

    for (let i = 1; i <= TOTAL_USERS; i++) {
      const isAdmin = i <= (TOTAL_USERS * ADMIN_RATIO);
      const user = {
        id: i,
        username: `user_${i}`,
        email: `user_${i}@loadtest.local`,
        role: isAdmin ? 'admin' : 'peer',
        department: departments[i % departments.length],
        status: statuses[i % statuses.length],
        score: (i * 17) % 1000,
        createdAt: new Date(Date.now() - (i * 3600000)).toISOString(),
      };

      this.users.set(i, user);
      this.usersList.push(user);

      if (isAdmin) {
        this.adminUserIds.push(i);
      } else {
        this.peerUserIds.push(i);
      }
    }

    console.log(`Seeded ${this.adminUserIds.length} Admins and ${this.peerUserIds.length} Peers.`);

    // Seed 10,000 generic records
    console.log('Seeding 10,000 feed records...');
    for (let i = 1; i <= 10000; i++) {
      const record = {
        id: i,
        title: `System Performance Feed Item #${i}`,
        category: departments[i % departments.length],
        authorId: (i % TOTAL_USERS) + 1,
        views: (i * 13) % 5000,
        commentsCount: (i * 3) % 40,
        tags: [`tag-${i % 15}`, `tag-${(i + 2) % 15}`, 'metric'],
        updatedAt: new Date(Date.now() - (i * 60000)).toISOString(),
      };
      this.records.push(record);
      this.recordsById.set(i, record);
    }
    console.log('Database seeding complete.');
  }

  // --- Peer Queries ---
  getUserById(id) {
    return this.users.get(Number(id)) || null;
  }

  getFeed(page = 1, limit = 20, category = null) {
    let result = this.records;
    if (category) {
      result = result.filter(r => r.category.toLowerCase() === category.toLowerCase());
    }
    const startIndex = (page - 1) * limit;
    return {
      total: result.length,
      page,
      limit,
      items: result.slice(startIndex, startIndex + limit),
    };
  }

  getRecordById(id) {
    return this.recordsById.get(Number(id)) || null;
  }

  searchRecords(query, limit = 20) {
    if (!query) return [];
    const q = query.toLowerCase();
    const matches = [];
    for (const item of this.records) {
      if (item.title.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)) {
        matches.push(item);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  // --- Admin Batch Operations ---
  batchInsertRecords(recordsBatch) {
    const inserted = [];
    for (const item of recordsBatch) {
      const newId = this.records.length + 1;
      const record = {
        id: newId,
        title: item.title || `Admin Uploaded Record #${newId}`,
        category: item.category || 'General',
        authorId: item.authorId || 1,
        views: 0,
        commentsCount: 0,
        tags: item.tags || ['admin-upload'],
        updatedAt: new Date().toISOString(),
      };
      this.records.unshift(record); // Add to head of feed
      this.recordsById.set(newId, record);
      inserted.push(record);
    }
    return inserted;
  }

  batchUpdateUsers(updates) {
    // updates: Array of { id, status, department }
    let modified = 0;
    for (const up of updates) {
      const user = this.users.get(Number(up.id));
      if (user) {
        if (up.status) user.status = up.status;
        if (up.department) user.department = up.department;
        modified++;
      }
    }
    return modified;
  }

  getAdminStats() {
    return {
      totalUsers: this.users.size,
      totalAdmins: this.adminUserIds.length,
      totalPeers: this.peerUserIds.length,
      totalRecords: this.records.length,
    };
  }
}

module.exports = new DataStore();
