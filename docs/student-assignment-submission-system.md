# Student Assignment Submission System

## Overview

This document describes the comprehensive student assignment submission system implemented for the École Digitale platform. The system allows students to view assignment details, submit responses in multiple formats, and track their submission status.

## Features

### 1. Assignment Detail View
- **Comprehensive Assignment Information**: Students can view detailed information about assignments including:
  - Assignment title and description
  - Course and instructor information
  - Due date and time remaining
  - Maximum points and grading criteria
  - Submission type and requirements
  - Current submission status

- **Tabbed Interface**: Clean organization with three main tabs:
  - **Détails**: Assignment information and requirements
  - **Ma soumission**: Submission interface based on assignment type
  - **Feedback**: Grades and instructor feedback (when available)

### 2. Multiple Submission Types

#### File Upload Submissions
- **Drag-and-drop interface** with visual feedback
- **File validation**: Type, size, and format checking
- **Progress tracking** during upload
- **File preview** and management
- **Replace/update** functionality for in-progress submissions
- **Download** capability for submitted files

#### Text Response Submissions
- **Rich text editor** with formatting options
- **Auto-save functionality** with 2-second debounce
- **Character and word count** tracking
- **Minimum/maximum length validation**
- **Real-time save status** indicators
- **Manual save** option

#### Online Evaluation Submissions
- **Interactive question interface** with multiple question types:
  - Single choice (radio buttons)
  - Multiple choice (checkboxes)
  - True/False questions
  - Short text responses
  - Fill-in-the-blank
- **Question navigation** with progress tracking
- **Timer functionality** with visual countdown
- **Auto-submit** when time expires
- **Answer persistence** and recovery
- **Progress saving** between sessions

### 3. Submission Status Management
- **Real-time status tracking**:
  - `pending`: No submission started
  - `in_progress`: Work in progress, can be edited
  - `submitted`: Final submission, cannot be edited
  - `graded`: Feedback and grades available

- **Visual status indicators** with color-coded badges
- **Status-based UI changes** (disable editing for submitted work)
- **Late submission handling** with appropriate warnings

### 4. User Experience Features
- **Responsive design** for desktop and mobile devices
- **Loading states** and error handling
- **Accessibility compliance** with ARIA labels and keyboard navigation
- **Intuitive navigation** with breadcrumbs and back buttons
- **Real-time feedback** for user actions

## Technical Architecture

### Frontend Components

#### Core Components
- `StudentAssignmentDetailPage`: Main page component with routing and authentication
- `FileUploadSubmission`: File upload interface with validation
- `TextResponseSubmission`: Text editor with auto-save
- `OnlineEvaluationSubmission`: Interactive evaluation interface

#### Supporting Components
- `useStudentData` hooks: API integration and state management
- `useDebounce`: Utility hook for auto-save functionality
- Error boundaries and loading states

### Backend API Endpoints

#### Submission Management
```
POST   /api/v1/assignments/:assignmentId/submissions
PATCH  /api/v1/assignments/:assignmentId/submissions/:submissionId
POST   /api/v1/assignments/:assignmentId/submissions/:submissionId/submit
GET    /api/v1/assignments/:assignmentId/submissions/my-submission
```

#### Features
- **Authentication and authorization** with role-based access
- **Tenant isolation** with row-level security
- **File upload handling** with progress tracking
- **Validation and error handling**
- **Audit logging** for submission activities

### Database Schema

#### Key Tables
- `assignments`: Assignment definitions and metadata
- `assignment_submissions`: Student submission records
- `assignment_submission_files`: File attachments
- `assignment_questions`: Online evaluation questions
- `assignment_answers`: Student responses to questions

## Security Considerations

### Authentication & Authorization
- **Session-based authentication** with NextAuth.js
- **Role-based access control** (students can only access their own submissions)
- **Tenant isolation** ensuring data separation between institutions

### Data Protection
- **Input validation** on both client and server
- **File type and size restrictions** to prevent malicious uploads
- **SQL injection prevention** with parameterized queries
- **XSS protection** with input sanitization

### File Security
- **Secure file storage** with access controls
- **Virus scanning** integration (recommended for production)
- **File type validation** based on content, not just extension
- **Size limits** to prevent storage abuse

## Performance Optimizations

### Frontend
- **React Query** for efficient data fetching and caching
- **Debounced auto-save** to reduce API calls
- **Lazy loading** of components and resources
- **Optimistic updates** for better user experience

### Backend
- **Database indexing** on frequently queried fields
- **Connection pooling** for database efficiency
- **File streaming** for large uploads
- **Caching strategies** for static content

## Testing Strategy

### Unit Tests
- **Component testing** with React Testing Library
- **Hook testing** for custom React hooks
- **API endpoint testing** with mocked dependencies
- **Utility function testing** for business logic

### Integration Tests
- **Full workflow testing** from UI to database
- **API integration testing** with real HTTP calls
- **Cross-component interaction testing**
- **Error scenario testing**

### End-to-End Tests
- **User journey testing** with Playwright
- **Cross-browser compatibility** testing
- **Mobile responsiveness** testing
- **Accessibility testing** with automated tools

## Deployment Guide

### Prerequisites
- Node.js 18+ and npm/yarn
- PostgreSQL 14+ database
- Redis for session storage (optional)
- File storage service (AWS S3, Google Cloud Storage, etc.)

### Environment Configuration
```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ecoledigitale
POSTGRES_PRISMA_URL=postgresql://user:password@localhost:5432/ecoledigitale

# Authentication
NEXTAUTH_SECRET=your-secret-key
NEXTAUTH_URL=http://localhost:3000

# File Storage
UPLOAD_MAX_SIZE=10485760  # 10MB
ALLOWED_FILE_TYPES=.pdf,.doc,.docx,.txt,.zip

# API Configuration
API_BASE_URL=http://localhost:4000
```

### Deployment Steps
1. **Database Migration**: Run Prisma migrations
2. **Build Application**: `npm run build`
3. **Start Services**: API server and web application
4. **Configure Reverse Proxy**: Nginx or similar for production
5. **SSL Certificate**: Enable HTTPS for security
6. **Monitoring**: Set up logging and error tracking

## Monitoring and Maintenance

### Key Metrics
- **Submission success rate**
- **File upload performance**
- **Auto-save frequency and success**
- **User engagement with different submission types**
- **Error rates and types**

### Maintenance Tasks
- **Database cleanup** of old temporary files
- **Log rotation** and archival
- **Performance monitoring** and optimization
- **Security updates** and patches
- **Backup verification** and disaster recovery testing

## Future Enhancements

### Planned Features
- **Rich text editor** with advanced formatting
- **Collaborative editing** for group assignments
- **Version history** and submission comparison
- **Plagiarism detection** integration
- **Mobile app** for iOS and Android

### Technical Improvements
- **Real-time collaboration** with WebSockets
- **Advanced file preview** (PDF, Office documents)
- **Offline support** with service workers
- **Advanced analytics** and reporting
- **API rate limiting** and throttling

## Support and Troubleshooting

### Common Issues
1. **File upload failures**: Check file size and type restrictions
2. **Auto-save not working**: Verify network connectivity and authentication
3. **Submission not found**: Check user permissions and assignment access
4. **Timer issues**: Ensure browser JavaScript is enabled

### Debug Information
- Check browser console for JavaScript errors
- Verify API responses in Network tab
- Review server logs for backend errors
- Test with different browsers and devices

### Contact Information
- **Technical Support**: support@ecoledigitale.com
- **Documentation**: https://docs.ecoledigitale.com
- **Bug Reports**: https://github.com/ecoledigitale/platform/issues

---

## Student User Guide

### Getting Started

#### Accessing Your Assignments
1. **Login** to your École Digitale account
2. **Navigate** to the "Mes devoirs" (My Assignments) section
3. **View** your assignment list with due dates and status
4. **Click** "Voir détails" to open any assignment

#### Understanding Assignment Status
- **🟡 En attente**: Assignment not yet started
- **🔵 En cours**: Work in progress, can be edited
- **🟢 Soumis**: Final submission completed
- **✅ Noté**: Graded with feedback available
- **🔴 En retard**: Past due date

### Submitting Different Assignment Types

#### File Upload Assignments
1. **Click** "Ma soumission" tab
2. **Drag and drop** your file or click "Sélectionner un fichier"
3. **Wait** for upload progress to complete
4. **Review** file details and click "Soumettre le fichier"
5. **Confirm** your final submission

**Tips:**
- Check file size limits (usually 10MB max)
- Ensure file type is allowed (.pdf, .doc, .docx, etc.)
- You can replace files before final submission

#### Text Response Assignments
1. **Click** "Ma soumission" tab
2. **Type** your response in the text area
3. **Monitor** word/character count
4. **Auto-save** happens every 2 seconds
5. **Click** "Soumettre la réponse" when ready

**Tips:**
- Your work saves automatically as you type
- Check minimum/maximum length requirements
- Use "Sauvegarder maintenant" for manual save

#### Online Evaluations
1. **Click** "Commencer l'évaluation" to start
2. **Answer** questions one by one
3. **Navigate** using "Précédent/Suivant" buttons
4. **Monitor** the timer (if time-limited)
5. **Click** "Soumettre" on the last question

**Tips:**
- You cannot pause once started
- Answers save automatically as you progress
- Review all questions before final submission

### Managing Your Submissions

#### Checking Submission Status
- **Status indicator** shows current state
- **Timestamp** shows when last saved/submitted
- **Progress bar** for multi-part assignments

#### Viewing Feedback
1. **Click** "Feedback" tab after grading
2. **Review** your grade and points earned
3. **Read** instructor comments and suggestions
4. **Download** any annotated files

#### Late Submissions
- **Warning indicators** appear for overdue assignments
- **Late submission** may be allowed depending on instructor settings
- **Contact instructor** if you need an extension

### Troubleshooting

#### Common Problems and Solutions

**File won't upload:**
- Check file size (max 10MB typically)
- Verify file type is allowed
- Try a different browser
- Check internet connection

**Text not saving:**
- Ensure you're logged in
- Check internet connection
- Try refreshing the page
- Contact support if problem persists

**Can't access assignment:**
- Verify you're enrolled in the course
- Check if assignment is published
- Ensure you have student role permissions

**Timer issues in evaluations:**
- Enable JavaScript in your browser
- Avoid switching browser tabs
- Use a stable internet connection
- Contact instructor immediately if timer malfunctions

#### Getting Help
- **In-app help**: Look for ? icons throughout the interface
- **Technical support**: Use the help chat or email support
- **Instructor contact**: Use course messaging system
- **Peer support**: Connect with classmates through course forums

### Best Practices

#### Before Starting
- **Read instructions** carefully
- **Check due dates** and plan accordingly
- **Prepare materials** (files, research, notes)
- **Test your setup** (internet, browser, files)

#### During Submission
- **Save frequently** (though auto-save helps)
- **Double-check** your work before submitting
- **Keep backups** of important files
- **Submit early** to avoid last-minute issues

#### After Submission
- **Confirm submission** was successful
- **Save confirmation** screenshots if needed
- **Check for feedback** regularly
- **Learn from comments** for future assignments

### Mobile Usage

#### Supported Features
- **View assignments** and details
- **Submit text responses** (with limitations)
- **Check grades** and feedback
- **Basic file uploads** (depending on device)

#### Limitations
- **Complex evaluations** work better on desktop
- **Large file uploads** may be slower
- **Rich text editing** has reduced functionality

#### Tips for Mobile
- **Use landscape mode** for better typing
- **Ensure stable WiFi** for uploads
- **Consider desktop** for complex assignments
- **Test functionality** before deadline
