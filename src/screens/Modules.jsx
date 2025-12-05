import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import { supabase } from '../supabaseClient'
import './Modules.css'

function Modules() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [addModuleModalOpen, setAddModuleModalOpen] = useState(false)
  const [uploadVideoModalOpen, setUploadVideoModalOpen] = useState(false)
  const [selectedModule, setSelectedModule] = useState(null)
  const [categoryFilter, setCategoryFilter] = useState('All Categories')
  const [modules, setModules] = useState([])
  const [categories, setCategories] = useState([])
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingVideos, setLoadingVideos] = useState(false)
  const [error, setError] = useState(null)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category_id: '',
    thumbnail_url: ''
  })
  const [searchTerm, setSearchTerm] = useState('')

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  const breadcrumbItems = [
    { label: 'Home', link: true },
    { label: 'Modules', link: false }
  ]

  // Fetch modules and categories from Supabase
  useEffect(() => {
    fetchCategories()
    fetchModules()
  }, [])

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('name', { ascending: true })

      if (error) throw error

      setCategories(data || [])
    } catch (error) {
      console.error('Error fetching categories:', error)
      // Don't set error state here, just log it
    }
  }

  const fetchModules = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const { data, error } = await supabase
        .from('modules')
        .select(`
          *,
          categories (
            id,
            name
          )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error

      setModules(data || [])
    } catch (error) {
      console.error('Error fetching modules:', error)
      setError(error.message || 'Failed to fetch modules. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const getCategoryName = (categoryId) => {
    if (!categoryId) return 'N/A'
    const category = categories.find(cat => cat.id === categoryId)
    return category ? category.name : 'N/A'
  }

  const handleAddModule = async () => {
    try {
      // Validate required fields
      if (!formData.title.trim()) {
        alert('Please enter a module title')
        return
      }

      setError(null)

      const { data, error } = await supabase
        .from('modules')
        .insert([{
          title: formData.title,
          description: formData.description || null,
          category_id: formData.category_id || null,
          thumbnail_url: formData.thumbnail_url || null
        }])
        .select()

      if (error) throw error

      // Close modal and refresh list
      setAddModuleModalOpen(false)
      setFormData({
        title: '',
        description: '',
        category_id: '',
        thumbnail_url: ''
      })
      await fetchModules()
      
      alert('Module added successfully!')
    } catch (error) {
      console.error('Error adding module:', error)
      setError(error.message || 'Failed to add module. Please try again.')
      alert('Failed to add module: ' + (error.message || 'Unknown error'))
    }
  }

  const handleDeleteModule = async (moduleId, e) => {
    e.stopPropagation()
    
    if (!confirm('Are you sure you want to delete this module?')) {
      return
    }

    try {
      const { error } = await supabase
        .from('modules')
        .delete()
        .eq('id', moduleId)

      if (error) throw error

      await fetchModules()
      alert('Module deleted successfully!')
    } catch (error) {
      console.error('Error deleting module:', error)
      alert('Failed to delete module: ' + (error.message || 'Unknown error'))
    }
  }

  const fetchVideosForModule = async (moduleId) => {
    try {
      setLoadingVideos(true)
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('module_id', moduleId)
        .order('created_at', { ascending: false })

      if (error) throw error

      setVideos(data || [])
    } catch (error) {
      console.error('Error fetching videos:', error)
      setVideos([])
    } finally {
      setLoadingVideos(false)
    }
  }

  const openDrawer = (module) => {
    setSelectedModule(module)
    setDrawerOpen(true)
    fetchVideosForModule(module.id)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setSelectedModule(null)
    setVideos([])
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  // Filter modules based on search and category
  const filteredModules = modules.filter(module => {
    const matchesSearch = module.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (module.description && module.description.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesCategory = categoryFilter === 'All Categories' || module.category_id === categoryFilter
    return matchesSearch && matchesCategory
  })

  const formatVideoDate = (dateString) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  const formatDuration = (seconds) => {
    if (!seconds) return 'N/A'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="dashboard-panel">
      <Sidebar />

      {/* Main Content */}
      <div className="main-content">
        <Header breadcrumbItems={breadcrumbItems} onMenuToggle={toggleSidebar} />

        {/* Modules Main Content */}
        <main className="modules-main">
          <section className="modules-header">
            <div>
              <h2>Training Modules</h2>
              <p>Manage, create, and organize all learning modules.</p>
            </div>
            <div className="action-buttons">
              <button className="btn btn-secondary" onClick={() => setUploadVideoModalOpen(true)}>
                <i className="fa-solid fa-upload"></i>Upload Video
              </button>
              <button className="btn btn-secondary" onClick={fetchModules}>
                <i className="fa-solid fa-arrows-rotate"></i>Refresh
              </button>
              <button className="btn btn-primary" onClick={() => setAddModuleModalOpen(true)}>
                <i className="fa-solid fa-plus"></i>Add Module
              </button>
            </div>
          </section>

          {/* Error Display */}
          {error && (
            <div className="error-message" style={{
              backgroundColor: '#FEE2E2',
              border: '1px solid #EF4444',
              color: '#991B1B',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <i className="fa-solid fa-circle-exclamation"></i>
              <span>{error}</span>
            </div>
          )}

          <section className="modules-table-container">
            <div className="table-filters">
              <div className="search-wrapper">
                <i className="fa-solid fa-magnifying-glass"></i>
                <input 
                  type="text" 
                  placeholder="Search modules..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="filter-select-wrapper">
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="All Categories">All Categories</option>
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                <i className="fa-solid fa-chevron-down"></i>
              </div>
            </div>

            {loading ? (
              <div style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center', 
                padding: '60px 20px',
                color: '#6B7280'
              }}>
                <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px', fontSize: '20px' }}></i>
                Loading modules...
              </div>
            ) : filteredModules.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '60px 20px',
                color: '#6B7280'
              }}>
                <i className="fa-solid fa-folder-open" style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}></i>
                <p style={{ fontSize: '18px', fontWeight: '500', marginBottom: '8px' }}>No modules found</p>
                <p style={{ fontSize: '14px' }}>
                  {modules.length === 0 
                    ? 'Get started by adding your first module.' 
                    : 'Try adjusting your search or filter criteria.'}
                </p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="modules-table">
                  <thead>
                    <tr>
                      <th>Module Title</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th>Created At</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModules.map(module => (
                      <tr key={module.id} className="module-row" onClick={() => openDrawer(module)}>
                        <td className="font-medium">{module.title}</td>
                        <td>{module.description ? (module.description.length > 50 ? module.description.substring(0, 50) + '...' : module.description) : 'N/A'}</td>
                        <td>{module.categories?.name || getCategoryName(module.category_id)}</td>
                        <td>{formatDate(module.created_at)}</td>
                        <td className="text-right">
                          <button className="action-btn edit-btn" onClick={(e) => { e.stopPropagation(); }}>
                            <i className="fa-solid fa-pencil"></i>
                          </button>
                          <button className="action-btn delete-btn" onClick={(e) => handleDeleteModule(module.id, e)}>
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="table-pagination">
              <span className="pagination-info">
                Showing <span className="font-semibold">1</span> to <span className="font-semibold">{filteredModules.length}</span> of <span className="font-semibold">{modules.length}</span> Entries
              </span>
              <div className="pagination-buttons">
                <button className="pagination-btn">Previous</button>
                <button className="pagination-btn">Next</button>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Videos Drawer */}
      <div className={`drawer-overlay ${drawerOpen ? 'active' : ''}`} onClick={closeDrawer}></div>
      <aside className={`videos-drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-content">
          <header className="drawer-header">
            <div>
              <h3>{selectedModule?.title || 'Module Videos'}</h3>
              <p>{videos.length} {videos.length === 1 ? 'Video' : 'Videos'}</p>
            </div>
            <button className="close-drawer-btn" onClick={closeDrawer}>
              <i className="fa-solid fa-xmark"></i>
            </button>
          </header>
          <div className="drawer-body">
            {loadingVideos ? (
              <div style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center', 
                padding: '40px 20px',
                color: '#6B7280'
              }}>
                <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px', fontSize: '18px' }}></i>
                Loading videos...
              </div>
            ) : videos.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '40px 20px',
                color: '#6B7280'
              }}>
                <i className="fa-solid fa-video" style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.5 }}></i>
                <p style={{ fontSize: '16px', fontWeight: '500', marginBottom: '8px' }}>No videos found</p>
                <p style={{ fontSize: '14px' }}>
                  No videos have been added to this module yet.
                </p>
              </div>
            ) : (
              <ul className="videos-list">
                {videos.map(video => (
                  <li key={video.id} className="video-item">
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p className="video-title">{video.title || 'Untitled Video'}</p>
                        <p className="video-meta">
                          {video.duration ? `Duration: ${formatDuration(video.duration)}` : 'Duration: N/A'} | 
                          Uploaded: {formatVideoDate(video.created_at)}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                        <span className={`status-badge ${video.status ? video.status.toLowerCase() : 'draft'}`}>
                          {video.status || 'Draft'}
                        </span>
                        <button className="icon-btn" title="Edit Video">
                          <i className="fa-solid fa-pencil"></i>
                        </button>
                        <button className="icon-btn delete" title="Delete Video">
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>

      {/* Add Module Modal */}
      {addModuleModalOpen && (
        <div className="modal-backdrop" onClick={() => setAddModuleModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add New Module</h3>
              <button onClick={() => setAddModuleModalOpen(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="module-title">Module Title <span style={{ color: '#EF4444' }}>*</span></label>
                <input 
                  type="text" 
                  id="module-title" 
                  placeholder="e.g., Introduction to Sales" 
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="module-description">Description</label>
                <textarea 
                  id="module-description" 
                  rows="3" 
                  placeholder="A brief summary of the module's content..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                ></textarea>
              </div>
              <div className="form-group">
                <label htmlFor="module-category">Category</label>
                <select 
                  id="module-category"
                  value={formData.category_id}
                  onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                >
                  <option value="">-- Select Category (Optional) --</option>
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                  Select the category this module belongs to
                </p>
              </div>
              <div className="form-group">
                <label htmlFor="module-thumbnail">Thumbnail URL</label>
                <input 
                  type="text" 
                  id="module-thumbnail" 
                  placeholder="https://example.com/image.jpg (optional)"
                  value={formData.thumbnail_url}
                  onChange={(e) => setFormData({ ...formData, thumbnail_url: e.target.value })}
                />
                <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                  Enter the URL of the thumbnail image
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => {
                setAddModuleModalOpen(false)
                setFormData({
                  title: '',
                  description: '',
                  category_id: '',
                  thumbnail_url: ''
                })
              }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddModule}>Save Module</button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Video Modal */}
      {uploadVideoModalOpen && (
        <div className="modal-backdrop" onClick={() => setUploadVideoModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Upload Video to Bunny CDN</h3>
              <button onClick={() => setUploadVideoModalOpen(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="upload-module-select">Select Module</label>
                <select id="upload-module-select">
                  <option value="">-- Select a Module --</option>
                  {modules.map(module => (
                    <option key={module.id} value={module.id}>{module.title}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="video-title">Video Title</label>
                <input type="text" id="video-title" placeholder="e.g., Introduction to Sales" />
              </div>
              <div className="form-group">
                <label>Video File</label>
                <div className="file-upload">
                  <i className="fa-solid fa-video"></i>
                  <div>
                    <label htmlFor="video-file-upload" className="upload-label">
                      <span>Upload a video</span>
                      <input id="video-file-upload" type="file" accept="video/*" className="hidden-input" />
                    </label>
                    <span className="upload-text">or drag and drop</span>
                  </div>
                  <p className="upload-hint">MP4, MOV, AVI up to 500MB</p>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setUploadVideoModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary">Upload Video</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Modules
